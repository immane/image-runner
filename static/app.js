const apiKeyInput = document.getElementById("apiKey");
const apiKeyLabel = document.getElementById("apiKeyLabel");
const modelSelect = document.getElementById("modelSelect");
const modelIdSelect = document.getElementById("modelIdSelect");
const saveApiKeyBtn = document.getElementById("saveApiKeyBtn");
const promptInput = document.getElementById("prompt");
const negativePromptInput = document.getElementById("negativePrompt");
const imageInput = document.getElementById("imageInput");
const uploadZone = document.getElementById("uploadZone");
const inputPreview = document.getElementById("inputPreview");
const outputPreview = document.getElementById("outputPreview");
const imageModal = document.getElementById("imageModal");
const imageModalPreview = document.getElementById("imageModalPreview");
const imageModalClose = document.getElementById("imageModalClose");
const runBtn = document.getElementById("runBtn");
const downloadBtn = document.getElementById("downloadBtn");
const statusNode = document.getElementById("status");
const defaultPreviewSrc = "/static/default-preview.svg";

let sourceDataUrl = "";
let sourceFileNameBase = "image";

function getProviderPrefix(model) {
  return model.split("/", 1)[0] || "unknown";
}

function getApiKeyStorageKey(model) {
  return `image-runner.apiKey.${getProviderPrefix(model)}`;
}

function loadApiKeyForCurrentProvider() {
  const storageKey = getApiKeyStorageKey(modelSelect.value);
  const saved = localStorage.getItem(storageKey) || "";
  apiKeyInput.value = saved;
}

modelSelect.addEventListener("change", () => {
  apiKeyLabel.textContent = "xAI API Key";

  loadApiKeyForCurrentProvider();
});

imageInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  await loadSourceFile(file);
});

inputPreview.addEventListener("click", () => {
  openImageModal(inputPreview.src);
});

outputPreview.addEventListener("click", () => {
  openImageModal(outputPreview.src);
});

imageModalClose.addEventListener("click", closeImageModal);

imageModal.addEventListener("click", (event) => {
  if (event.target === imageModal) {
    closeImageModal();
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !imageModal.hidden) {
    closeImageModal();
  }
});

uploadZone.addEventListener("dragenter", (event) => {
  event.preventDefault();
  uploadZone.classList.add("drag-over");
});

uploadZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  uploadZone.classList.add("drag-over");
});

uploadZone.addEventListener("dragleave", (event) => {
  event.preventDefault();
  const nextTarget = event.relatedTarget;
  if (!nextTarget || !uploadZone.contains(nextTarget)) {
    uploadZone.classList.remove("drag-over");
  }
});

uploadZone.addEventListener("drop", async (event) => {
  event.preventDefault();
  uploadZone.classList.remove("drag-over");

  const file = event.dataTransfer?.files?.[0];
  if (!file) {
    setStatus("Drop failed: no file found.", true);
    return;
  }

  imageInput.files = event.dataTransfer.files;
  await loadSourceFile(file);
});

window.addEventListener("dragover", (event) => {
  event.preventDefault();
});

window.addEventListener("drop", (event) => {
  if (!uploadZone.contains(event.target)) {
    event.preventDefault();
  }
});

saveApiKeyBtn.addEventListener("click", () => {
  const model = modelSelect.value;
  const apiKey = apiKeyInput.value.trim();

  if (!apiKey) {
    setStatus("Please input API key before saving.", true);
    return;
  }

  localStorage.setItem(getApiKeyStorageKey(model), apiKey);
  setStatus("API key saved in this browser.");
});

downloadBtn.addEventListener("click", async () => {
  if (!outputPreview.src) {
    setStatus("No output image to download.", true);
    return;
  }

  try {
    downloadBtn.disabled = true;
    setStatus("Preparing PNG download...");
    const pngBlob = await renderImageUrlToPngBlob(outputPreview.src);
    const filename = `${sourceFileNameBase}-regenerated.png`;
    triggerBlobDownload(pngBlob, filename);
    setStatus(`Downloaded: ${filename}`);
  } catch (error) {
    setStatus(error.message || "Failed to download image.", true);
  } finally {
    downloadBtn.disabled = false;
  }
});

runBtn.addEventListener("click", async () => {
  const model = modelSelect.value;
  const custom_model_id = modelIdSelect.value;
  const api_key = apiKeyInput.value.trim();
  const prompt = promptInput.value.trim();
  const negative_prompt = negativePromptInput.value.trim();

  if (!api_key) {
    setStatus("Please enter xAI API Key.", true);
    return;
  }
  if (!prompt) {
    setStatus("Please enter prompt.", true);
    return;
  }
  if (!sourceDataUrl) {
    setStatus("Please upload an image first.", true);
    return;
  }

  runBtn.disabled = true;
  setStatus("Generating...");

  try {
    const response = await fetch("/api/img2img", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        custom_model_id,
        api_key,
        prompt,
        negative_prompt,
        image: sourceDataUrl
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Request failed");
    }

    outputPreview.src = data.image;
    downloadBtn.disabled = false;
    setStatus("Done. Image generated.");
  } catch (error) {
    setStatus(error.message || "Unknown error", true);
  } finally {
    runBtn.disabled = false;
  }
});

function setStatus(text, isError = false) {
  statusNode.textContent = text;
  statusNode.style.color = isError ? "#ff7d7d" : "#93a1c0";
}

async function loadSourceFile(file) {
  if (!file) {
    return;
  }
  if (!file.type.startsWith("image/")) {
    setStatus("Only image files are supported.", true);
    return;
  }

  sourceDataUrl = await fileToDataUrl(file);
  sourceFileNameBase = normalizeFilenameBase(file.name);
  inputPreview.src = sourceDataUrl;
  outputPreview.src = defaultPreviewSrc;
  downloadBtn.disabled = true;
  setStatus("Image loaded.");
}

modelSelect.dispatchEvent(new Event("change"));

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function normalizeFilenameBase(filename) {
  const dotIndex = filename.lastIndexOf(".");
  const raw = dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
  const sanitized = raw.trim().replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/-+/g, "-");
  return sanitized || "image";
}

async function renderImageUrlToPngBlob(imageUrl) {
  const image = new Image();
  image.decoding = "async";

  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error("Unable to decode output image."));
    image.src = imageUrl;
  });

  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas context not available.");
  }

  ctx.drawImage(image, 0, 0);

  const blob = await new Promise((resolve) => {
    canvas.toBlob(resolve, "image/png", 1);
  });

  if (!blob) {
    throw new Error("Failed to encode PNG.");
  }

  return blob;
}

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function openImageModal(imageSrc) {
  if (!imageSrc) {
    return;
  }
  imageModalPreview.src = imageSrc;
  imageModal.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeImageModal() {
  imageModal.hidden = true;
  imageModalPreview.removeAttribute("src");
  document.body.style.overflow = "";
}
