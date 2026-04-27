# NotebookLM Anchor Contract (Stage 2)

## 1) PageCommand 真源定义
`page-commands.v1.json` 是 analyze -> process 的统一真源，由 `python/extract_page_commands.py` 通过 pikepdf 直接解析页面内容流生成。

`PageCommand` 当前最小必备字段：
- `page`
- `commandIndex`
- `operatorName`
- `operatorType` (`xobject_do` | `vector_paint` | `text_show` | `text_block`)
- `operandsRaw`
- `resourceName`
- `graphicsDepth`
- `ctm`
- `textBlockId`
- `fontName`
- `fontSize`
- `decodedText`
- `normalizedText`
- `bbox`

可选增强字段（用于聚类和二次校验）：
- `commandWindowBefore`
- `commandWindowAfter`
- `strokeColor`
- `fillColor`
- `lineWidth`
- `textMatrix`
- `textLineMatrix`
- `inlineImageInfo`

## 2) Analyze 与 Process 数据流
1. `engine/python/cli.py analyze` 产生初始分析快照（保留兼容用途）。
2. `python/extract_page_commands.py` 解析真实内容流，生成 `page-commands.v1.json`。
3. `lib/cleanup/analyze-v1.ts` 读取 `page-commands.v1.json`，按命令聚类生成 `CleanupCandidate` 与 `anchors`。
4. `POST /api/jobs/[jobId]/process` 写入：
   - `process-request.v2.json`
   - `execution-map.v1.json`
5. `python/process_pdf_v2.py` 执行 TokenFilter 删除并写入：
   - `processed.pdf`
   - `process-report.json`

## 3) Parser 与 Filter 职责边界
- Parser (`extract_page_commands.py`)：
  - 只负责读取、编号、状态跟踪、结构化输出；
  - 不做 PDF 重建，不做删除动作。
- Filter (`process_pdf_v2.py`)：
  - 只根据 anchors 做真实删除；
  - 删除前执行命令级二次校验；
  - 不反向推断或重构 PageCommand。

## 4) Review 字段 vs Execution 必需字段
Review 展示字段（`GET /api/jobs/[jobId]`）：
- `generatedAt`
- `supportedCount` / `unsupportedCount`
- `candidates[]`
- `unsupportedReasons`
- `qualityMetrics`
- `metricsComparison`（`previous` / `current` / `delta`）
- `executionPayload.pageCommandCount`

Execution 必需字段（每个 anchor）：
- `page`
- `commandStart`
- `commandEnd`
- `operatorType`
- `operatorName`
- `resourceName`（`xobject_do` 必需）
- `graphicsDepth`（`vector_paint` / 需深度约束时必需）
- `reliability`
- `removalStrategy`

## 5) 三类 Candidate 聚类依据
- `image`:
  - `Do`
  - `resourceName`
  - quantized `bbox`
  - quantized `ctm`
  - repeated page set
- `vector`:
  - vector drawing block（不是单一 paint 命令窗口）
  - block 边界：`commandStart..commandEnd`
  - path segment：`pathStart..pathEnd`
  - paint segment：`paintStart..paintEnd`
  - `graphicsDepth`
  - `patternSignature` / `spanShapeSignature`
  - `bbox` repeated pattern
- `text`:
  - `normalizedText`
  - `fontName`
  - `fontSize`
  - quantized position
  - textBlock local order
  - repeated page set

## 6) Reliability 与执行策略
- `text`: 仅 `reliable` 可执行。
- `image/vector`: `reliable` / `probable` 可执行。
- `weak`: 一律跳过（`no_reliable_anchor`）。

## 7) Process 二次校验与 skip 原因
执行前最少校验：
- page
- operatorType
- operatorName
- command span shape
- resourceName（适用时）
- graphicsDepth（适用时）

当前 skip reason 枚举：
- `operator_mismatch`
- `resource_name_mismatch`
- `span_shape_mismatch`
- `graphics_depth_mismatch`
- `no_instruction_removed`
- `anchor_unreliable`
- `candidate_not_found`
- `anchor_missing`
- `page_out_of_range`

## 8) Vector Drawing Block 契约（本轮新增）
vector anchor 必须携带：
- `blockId`
- `commandStart` / `commandEnd`
- `pathStart` / `pathEnd`
- `paintStart` / `paintEnd`
- `graphicsDepth`
- `pathOperators[]`
- `paintOperators[]`
- `spanShapeSignature`

process 在 `remove_vector_ops_by_range` 前必须验证：
1. span 覆盖关系有效（`commandStart <= pathStart <= pathEnd <= paintStart <= paintEnd <= commandEnd`）
2. path operator 组存在
3. paint operator 组存在
4. graphicsDepth 匹配
5. spanShapeSignature 可匹配（允许忽略 bbox 前缀做近似匹配）

若 block 边界不完整或签名不匹配，必须优先 `skip`，而不是放宽删除范围。

## 9) Vector Block Failure Diagnostics
核心 `reason` 与 `detail.subtype` 区分：
- `reason`：对外稳定枚举，保持兼容（`span_shape_mismatch` / `graphics_depth_mismatch` / `no_instruction_removed` 等）。
- `detail.subtype`：内部调参诊断维度（例如 `missing_path_segment`、`signature_operator_sequence_mismatch`）。

process 侧三阶段：
1. `precheck`
   - 检查 block 覆盖关系、path/paint segment 存在性、operator 序列、signature 匹配、depth。
2. `delete`
   - 记录删除前命令数、命中 block 范围命令数、实际删除命令数。
3. `postcheck`
   - 记录残留 path/paint 命令，判定是否有残片 block。

`process-debug.v1.json` 用途：
- 汇总每个 vector anchor 的 precheck/delete/postcheck 详情。
- 支持快速统计 Top 失败模式。
- 为调节 vector block 边界规则提供证据（而不是只看粗粒度 reason）。

如何依据 detail 反调边界规则：
- `missing_path_segment` 高：优先放宽路径段反向追溯停止条件（但保持 q/Q 边界保护）。
- `signature_operator_sequence_mismatch` 高：优先优化签名中的 operator 序列归一化。
- `delete_pass_left_residual_path/paint` 高：优先修正删除范围生成逻辑，确保 path+paint 同步删除。

## 10) Vector Failure Bucket Diagnostics
聚合诊断新增三类 bucket：
- **exporter bucket**
  - 来源：`Producer/Creator` 元数据 + object stream / content stream 压缩特征
  - 字段：`rawProducer`、`rawCreator`、`normalizedProducerFamily`、`normalizedCreatorFamily`、`exporterBucketId`
- **template page bucket**
  - 来源：页面 mix ratio、重复 block 模式、footer/header 区域分布、depth band
  - 字段：`templatePageSignature`
- **structure bucket**
  - 来源：结构标签（如 `objectStreamsEnabled`、`vectorHeavyPage`、`deepGraphicsStack`）

新增产物：`process-debug-summary.v1.json`
- 汇总 `exporterBuckets/templateBuckets/structureBuckets`
- 给出 `topFailureModes` 与 `recommendations`
- 每个 bucket 带 `representativeSamples`，可回链到 `jobId/page/candidateId/blockId`

如何基于 bucket 反推优化方向：
- `exporterBucket` 失败集中：优先处理导出器相关 signature/序列漂移容差。
- `templateBucket` 失败集中：优先调整对应页面布局下的 path 回溯边界规则。
- `structureBucket` 失败集中：优先校准 depth 匹配与删除后残片判定策略。

## 11) Regression Replay Sampling
新增回放产物：
- `regression-replay-plan.v1.json`
- `regression-suite-manifest.v1.json`

`regression-replay-plan.v1.json` 用途：
- 将 bucket 统计直接转为可执行 replay 条目。
- 每个条目包含 `jobId/page/candidateId/blockId`、`selectionPayload`、调试 snippet 与中间产物路径。

replay item 关键字段：
- `replayId`
- `priority` / `priorityScore`
- `replayClass`（`failure` | `success_control` | `near_miss`）
- `bucketType` / `bucketId`
- `templatePageSignature`
- `structureTags`
- `coreReason` / `subtype`
- `selectionPayload`
- `artifacts`（`pageCommandsPath` / `executionMapPath` / `processDebugPath` / `processReportPath`）

三类样本区别：
- `failure`：用于直接修规则。
- `success_control`：用于防止规则调整后打坏原有成功案例。
- `near_miss`：用于判断下一轮是否应放宽或收紧容差。

避免 bucket 采样偏斜：
- 去重键：`jobId/page/candidateId/blockId`
- 限制同 bucket 下单 job 占比
- 同时覆盖 exporter/template/structure 三类 bucket
- 样本不足时回退到 representative samples

如何用于下一轮调优：
- 先按 `nextFixTargets` 排序选高优先 replay。
- 规则改动后复跑 `failure + success_control + near_miss` 对照集。
- 对比 `vectorSpanShapeMismatchCount` / `vectorNoInstructionRemovedCount` / `partialHitCandidateCount` 变化。

## 12) Offline Regression Replay CLI
离线入口：
- 单 job：`python/regression_replay_plan.py --job-dir <job-dir>`
- 多 job：`python/regression_replay_plan.py --jobs-root <jobs-root> --job-glob "job_*"`

常用参数：
- 过滤：
  - `--exporter-bucket`
  - `--template-bucket`
  - `--structure-bucket`
  - `--subtype`
  - `--core-reason`
  - `--replay-class`
  - `--priority`
- 抽样：
  - `--per-exporter-subtype-limit`
  - `--per-template-bucket-limit`
  - `--per-structure-bucket-limit`
  - `--max-items`
  - `--include-success-controls`
  - `--include-near-miss`
- 输出：
  - `--output-dir`

输出产物：
- `regression-replay-plan.v1.json`
- `regression-suite-manifest.v1.json`
- `regression-suite-summary.v1.json`（多 job 聚合）
- `replay-index.v1.json`（轻量筛选索引）

`replay-index.v1.json` 用途：
- 按 bucket/subtype/priority/replayClass 快速筛选回放条目；
- 可直接回链到 source plan 与具体 `job/page/candidate/block`。

`regression-suite-summary.v1.json` 用途：
- 汇总扫描覆盖度、top failure buckets、top subtypes、next fix targets；
- 支持快速确定下一轮规则调优的优先范围。
