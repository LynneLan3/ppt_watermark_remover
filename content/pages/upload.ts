export type UploadListItem = {
  title: string;
  description: string;
};

export type UploadPageContent = {
  hero: {
    title: string;
    description: string;
    badge: string;
  };
  toolPanel: {
    uploadTitle: string;
    uploadButtonLabel: string;
    supportedFormatsLabel: string;
    helperText: string;
    availabilityTitle: string;
    availabilityText: string;
    statusTitle: string;
    statusItems: string[];
  };
  trustSummary: {
    title: string;
    intro: string;
    points: string[];
  };
  placeholder: {
    panelTitle: string;
    panelDescription: string;
    canvasLabel: string;
    pageNavLabel: string;
    zoomLabel: string;
    selectionLabel: string;
    resultLabel: string;
  };
  runLocalPanel: {
    title: string;
    intro: string;
    verifyTitle: string;
    applyTitle: string;
    copyVerifyLabel: string;
    copyTemplateLabel: string;
    copyExampleLabel: string;
    templateTitle: string;
    exampleTitle: string;
    templateCommandTitle: string;
    exampleCommandTitle: string;
    placementTitle: string;
    placementText: string;
    replacementTitle: string;
    replaceWarning: string;
    replaceHints: string[];
    outputNote: string;
    quickStartTitle: string;
    quickStartSteps: string[];
    preflightTitle: string;
    preflightItems: string[];
    whatYouHaveTitle: string;
    nextStepTitle: string;
    commandTitle: string;
    outputTitle: string;
    outputItems: string[];
    resultGuideTitle: string;
    resultGuideItems: string[];
    successFailSafeTitle: string;
    successFailSafeItems: string[];
    commonMistakesTitle: string;
    commonMistakes: string[];
    reportExamplesTitle: string;
    successExampleTitle: string;
    successExampleJson: string;
    successExampleNotes: string[];
    failSafeExampleTitle: string;
    failSafeExampleJson: string;
    failSafeExampleNotes: string[];
    outputLocationTitle: string;
    outputLocationText: string;
    exampleNote: string;
    regenerateTitle: string;
    regenerateItems: string[];
    supportNote: string;
  };
  workflowGuideCard: {
    title: string;
    description: string;
    linkLabel: string;
    linkHref: string;
    pathLabel: string;
  };
  howLocalModeWorks: {
    title: string;
    intro: string;
    steps: UploadListItem[];
  };
  proof: {
    title: string;
    intro: string;
    beforeLabel: string;
    afterLabel: string;
    beforeNotes: string[];
    afterNotes: string[];
  };
  scenarios: {
    title: string;
    intro: string;
    items: UploadListItem[];
  };
  limits: {
    title: string;
    intro: string;
    items: string[];
  };
  faq: {
    title: string;
    items: UploadListItem[];
  };
  cta: {
    title: string;
    description: string;
    links: {
      home: {
        href: string;
        label: string;
      };
      privacy: {
        href: string;
        label: string;
      };
      contact: {
        href: string;
        label: string;
      };
    };
  };
};

export const uploadPageContent: UploadPageContent = {
  hero: {
    title: "NotebookLM export cleanup",
    description:
      "Upload NotebookLM export, preview cleaned result, then download cleaned file after confirmation.",
    badge: "Temporary upload mode",
  },
  toolPanel: {
    uploadTitle: "Upload NotebookLM export",
    uploadButtonLabel: "Upload NotebookLM export",
    supportedFormatsLabel: "Current supported format on this page: PDF",
    helperText:
      "Temporary upload, auto delete, no training, secure processing.",
    availabilityTitle: "Current product mode",
    availabilityText:
      "Current flow: upload NotebookLM export -> preview cleaned result -> download cleaned file.",
    statusTitle: "Processing flow",
    statusItems: [
      "Temporary storage only: source files are not kept as a permanent archive.",
      "Deletion policy: files are deleted after download or short expiry.",
      "Training policy: uploaded files are not used for model training.",
      "Unsupported structures are blocked to protect document quality.",
    ],
  },
  trustSummary: {
    title: "Trust and handling summary",
    intro:
      "The primary workflow now uses secure temporary server-side processing with short-lived file retention.",
    points: [
      "Temporary storage only during analysis and cleanup.",
      "Files are deleted after download or short expiry.",
      "Uploaded files are not used for training.",
      "No long-term archive of uploaded files.",
    ],
  },
  placeholder: {
    panelTitle: "Preview cleaned result",
    panelDescription:
      "Inspect pages, review removable candidates, and confirm cleanup scope before download.",
    canvasLabel: "PDF page canvas",
    pageNavLabel: "Page navigation",
    zoomLabel: "Zoom",
    selectionLabel: "Candidate selection",
    resultLabel: "Preview output",
  },
  runLocalPanel: {
    title: "Run locally with Python engine",
    intro:
      "After generating and downloading a removal plan JSON, run the local engine manually to produce a cleaned PDF and report JSON.",
    verifyTitle: "Verify local engine setup",
    applyTitle: "Apply downloaded plan",
    copyVerifyLabel: "Copy verify command",
    copyTemplateLabel: "Copy template command",
    copyExampleLabel: "Copy example command",
    templateTitle: "Template command",
    exampleTitle: "Example command based on your current file",
    templateCommandTitle: "Template command (edit paths first)",
    exampleCommandTitle: "Example command (near-runnable after small edits)",
    placementTitle: "File placement guidance",
    placementText:
      "Save your original PDF and the downloaded removal plan JSON in the same folder, such as Downloads. Then copy the example command and adjust only the folder path if needed.",
    replacementTitle: "What you need to replace",
    replaceWarning:
      "Replace these paths with your actual local file paths before running. Do not run the template command unchanged.",
    replaceHints: [
      "Replace <YOUR_USERNAME> with your local macOS username.",
      "If files are not in Downloads, replace the full path for --input, --plan, --output, and --report.",
      "Ensure the PDF filename matches your real local input file name.",
      "Ensure the plan filename matches the downloaded .removal-plan.json file name.",
      "Keep quotes around paths if they contain spaces.",
    ],
    outputNote:
      "Output files are written to the same folder path used in the command unless you change that folder path.",
    quickStartTitle: "Recommended quick path",
    quickStartSteps: [
      "Download the removal plan JSON.",
      "Put the original PDF and plan JSON in Downloads.",
      "Copy the example command.",
      "Replace <YOUR_USERNAME>.",
      "Run it in Terminal.",
      "Open the generated .cleaned.pdf and .report.json.",
    ],
    preflightTitle: "Preflight checklist",
    preflightItems: [
      "Original PDF is saved locally.",
      "Downloaded removal plan JSON is saved locally.",
      "Both files are in the expected folder.",
      "<YOUR_USERNAME> has been replaced.",
      "Paths and filenames match the actual local files.",
    ],
    whatYouHaveTitle: "Current handoff package",
    nextStepTitle: "Next step",
    commandTitle: "Run apply-plan locally",
    outputTitle: "Expected outputs",
    outputItems: [
      "A cleaned PDF generated by the local engine",
      "A machine-readable report JSON with matched/removed counts and warnings",
      "Fail-safe refusal when target removal is unsupported",
    ],
    resultGuideTitle: "How to read the result",
    resultGuideItems: [
      "The cleaned PDF is the visual output file to inspect.",
      "The report JSON is a structured outcome summary.",
      "Check report fields: success, objectType, matchedObjectsCount, removedObjectsCount, warnings, failureReason.",
    ],
    successFailSafeTitle: "Success vs fail-safe",
    successFailSafeItems: [
      "Success: supported candidate objects were matched and removed.",
      "Fail-safe abort: engine refused to proceed because candidate was unsafe or unsupported.",
      "Fail-safe abort is expected behavior for unsupported cases, not a broken workflow.",
    ],
    commonMistakesTitle: "Common mistakes and fixes",
    commonMistakes: [
      "File not found: verify the file exists at the exact path in the command.",
      "Wrong folder path: update the folder path for --input, --plan, --output, and --report.",
      "Wrong filename: ensure names exactly match your local PDF and downloaded plan JSON.",
      "Plan JSON path mismatch: confirm --plan points to the downloaded .removal-plan.json file.",
      "Placeholder values run literally: replace <YOUR_USERNAME> and any placeholder path tokens first.",
      "Unsupported object/fail-safe abort: review removability and choose a supported candidate.",
    ],
    reportExamplesTitle: "Report JSON examples",
    successExampleTitle: "Success example",
    successExampleJson: `{
  "success": true,
  "objectType": "text_run",
  "matchedObjectsCount": 4,
  "removedObjectsCount": 4,
  "warnings": [],
  "failureReason": null
}`,
    successExampleNotes: [
      "success=true means the engine completed removal.",
      "matchedObjectsCount and removedObjectsCount show how many objects were found and removed.",
      "warnings may still contain non-fatal notes.",
    ],
    failSafeExampleTitle: "Fail-safe example",
    failSafeExampleJson: `{
  "success": false,
  "objectType": "image_xobject",
  "matchedObjectsCount": 0,
  "removedObjectsCount": 0,
  "warnings": [],
  "failureReason": "Matched repeat group is not marked supported; refusing to apply removal."
}`,
    failSafeExampleNotes: [
      "success=false with a failureReason is expected for unsupported or unsafe cases.",
      "Fail-safe abort protects the document from destructive or ambiguous edits.",
      "Choose a supported candidate and regenerate the plan before retrying.",
    ],
    outputLocationTitle: "Where files will appear",
    outputLocationText:
      "The cleaned PDF and report JSON are written to the output paths in the command. If the example command uses Downloads, outputs will appear in Downloads unless you change the path.",
    exampleNote:
      "This example is based on your current analyzed filename. You still need to replace <YOUR_USERNAME> and adjust the folder if your files are not in Downloads.",
    regenerateTitle: "When to regenerate the plan",
    regenerateItems: [
      "Regenerate if you choose a different candidate.",
      "Regenerate if you change scope or page range.",
      "Regenerate if the source PDF changes.",
      "Do not reuse an old plan for a different file.",
    ],
    supportNote:
      "Only proceed when removability is supported. Review-required and unsupported targets may fail safely.",
  },
  workflowGuideCard: {
    title: "How local removal works",
    description:
      "Open the local workflow guide for setup, supported cases, and exact end-to-end commands.",
    linkLabel: "Open local workflow guide",
    linkHref: "/local-engine-workflow.md",
    pathLabel: "docs/local-engine-workflow.md",
  },
  howLocalModeWorks: {
    title: "Workflow",
    intro:
      "Current round focuses on planning-quality object analysis, not generic rectangle cover export.",
    steps: [
      {
        title: "Load local PDF",
        description:
          "Open a PDF in-browser to render pages with local preview controls.",
      },
      {
        title: "Analyze object candidates",
        description:
          "Detect likely independent text objects and small repeated image XObject overlays.",
      },
      {
        title: "Inspect removability",
        description:
          "Review candidate type, bounds, repeat count, confidence, and support status.",
      },
      {
        title: "Generate removal plan JSON",
        description:
          "Select scope and produce a machine-readable handoff plan for pikepdf or PyMuPDF.",
      },
    ],
  },
  proof: {
    title: "Before and after direction",
    intro:
      "Visual direction focuses on true object-level deletion where independent objects exist, with minimal visual change to the original page.",
    beforeLabel: "Original PDF",
    afterLabel: "Target outcome",
    beforeNotes: [
      "Repeated logo/header/footer objects remain visible",
      "Brand marks appear on multiple pages",
      "Some files include flattened backgrounds",
    ],
    afterNotes: [
      "Independent repeated marks are targeted first",
      "Original layout and content stay intact as much as possible",
      "Flattened/background-only marks are flagged unsupported",
    ],
  },
  scenarios: {
    title: "Supported-first scenarios",
    intro: "Object-level removal is prioritized for repeatable, independently selectable marks.",
    items: [
      {
        title: "Repeated header text",
        description:
          "Small text runs near page top repeated across many pages.",
      },
      {
        title: "Repeated footer text",
        description:
          "Persistent footer labels or export marks near page bottom.",
      },
      {
        title: "Repeated logos and corner marks",
        description:
          "Small image/form objects reused in fixed positions.",
      },
      {
        title: "Independent image/form objects",
        description:
          "Image XObject or Form XObject candidates separated from the background.",
      },
    ],
  },
  limits: {
    title: "Important limits",
    intro:
      "This product direction is explicit about unsupported conditions to avoid visually damaging fake cleanup.",
    items: [
      "No guarantee that every PDF watermark/mark is independently removable.",
      "No claim of 100% lossless output across all files.",
      "Targets baked into full-page images/backgrounds may be unsupported.",
      "Rectangle cover-up is not the recommended primary workflow.",
    ],
  },
  faq: {
    title: "Object-removal planning FAQ",
    items: [
      {
        title: "Can this remove every watermark from every PDF?",
        description:
          "No. Removal depends on whether the target exists as an independent PDF object.",
      },
      {
        title: "What happens when a page is flattened?",
        description:
          "The workflow marks those targets as potentially unsupported instead of pretending removal with destructive cover-up.",
      },
      {
        title: "What is the current main output?",
        description:
          "A structured object-removal plan JSON for a dedicated PDF engine.",
      },
      {
        title: "Why not export a cleaned PDF directly in browser now?",
        description:
          "Because true object deletion needs engine-level PDF editing to preserve original appearance as much as possible.",
      },
    ],
  },
  cta: {
    title: "Need help with a specific export cleanup case?",
    description:
      "Use support and policy pages for workflow questions while keeping cleanup actions in upload-preview-download flow.",
    links: {
      home: {
        href: "/",
        label: "Try the tool",
      },
      privacy: {
        href: "/privacy-policy",
        label: "View privacy policy",
      },
      contact: {
        href: "/contact",
        label: "Go to support",
      },
    },
  },
};
