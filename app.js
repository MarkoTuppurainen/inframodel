import * as xmllint from "https://cdn.jsdelivr.net/npm/xmllint-wasm@5.1.0/index-browser.mjs";

const SCHEMA_SOURCES = [
  {
    fileName: "inframodel-raw.xsd",
    url: "https://cdn.jsdelivr.net/gh/buildingSMART-Finland/InfraModel@4.2.0/schema/inframodel-raw.xsd"
  },
  {
    fileName: "im-raw.xsd",
    url: "https://cdn.jsdelivr.net/gh/buildingSMART-Finland/InfraModel@4.2.0/schema/im-raw.xsd"
  }
];

let schemaCache = null;

window.validateXML = validateXML;

async function validateXML() {
  const fileInput = document.getElementById("fileInput");
  const result = document.getElementById("result");

  result.innerHTML = "Käsitellään...";

  if (!fileInput.files.length) {
    result.innerHTML = "<span class='error'>Valitse tiedosto</span>";
    return;
  }

  const file = fileInput.files[0];
  const xmlText = await file.text();

  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, "application/xml");
  const errorNode = xmlDoc.querySelector("parsererror");

  if (errorNode) {
    result.innerHTML = `<span class="error">❌ XML ei ole hyvin muodostettu:\n${escapeHtml(errorNode.textContent)}</span>`;
    return;
  }

  try {
    const schemaFiles = await loadSchemas();

    const validationResult = await xmllint.validateXML({
      xml: [
        {
          fileName: sanitizeFileName(file.name || "uploaded.xml"),
          contents: xmlText
        }
      ],
      schema: schemaFiles
    });

    if (validationResult.valid) {
      result.innerHTML = `<span class="success">✅ XML validoitui InfraModel 4.2.0 -skeemaa vasten</span>`;
      return;
    }

    const formattedErrors = formatValidationErrors(validationResult.errors);
    result.innerHTML = `<span class="error">❌ XML ei läpäissyt InfraModel-validointia:\n${escapeHtml(formattedErrors)}</span>`;
  } catch (error) {
    result.innerHTML = `<span class="error">Virhe validoinnissa:\n${escapeHtml(String(error))}</span>`;
  }
}

async function loadSchemas() {
  if (schemaCache) {
    return schemaCache;
  }

  const responses = await Promise.all(
    SCHEMA_SOURCES.map(async (schema) => {
      const response = await fetch(schema.url, { cache: "force-cache" });

      if (!response.ok) {
        throw new Error(`Skeeman lataus epäonnistui: ${schema.fileName} (${response.status})`);
      }

      const contents = await response.text();

      return {
        fileName: schema.fileName,
        contents
      };
    })
  );

  schemaCache = responses;
  return schemaCache;
}

function formatValidationErrors(errors) {
  if (!errors || !errors.length) {
    return "Tuntematon validointivirhe.";
  }

  return errors
    .map((error, index) => {
      const lineInfo = error.loc?.lineNumber ? `rivi ${error.loc.lineNumber}` : "rivi tuntematon";
      const fileInfo = error.loc?.fileName ? `${error.loc.fileName}, ${lineInfo}` : lineInfo;
      const message = error.message || error.rawMessage || "Tuntematon virhe";
      return `${index + 1}. ${fileInfo}: ${message}`;
    })
    .join("\n");
}

function sanitizeFileName(fileName) {
  const cleaned = fileName
    .replace(/[^\w.\-]/g, "_")
    .replace(/^\-+/, "");

  if (!cleaned || cleaned.startsWith("-") || cleaned.includes(" -")) {
    return "uploaded.xml";
  }

  return cleaned;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}