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

  // 🔹 1. XML syntaksin tarkistus
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, "application/xml");
  const errorNode = xmlDoc.querySelector("parsererror");

  if (errorNode) {
    result.innerHTML = `<span class="error">❌ XML ei ole hyvin muodostettu:\n${escapeHtml(errorNode.textContent)}</span>`;
    return;
  }

  // 🔹 2. InfraModel-perustarkistus
  const root = xmlDoc.documentElement;
  const rootName = root.nodeName;

  // InfraModel XML:ssä tyypillisiä rootteja
  const validRoots = ["InfraModel", "IM", "LandXML"];

  if (!validRoots.includes(rootName)) {
    result.innerHTML = `<span class="error">
❌ XML ei näytä InfraModel-tiedostolta

Root-elementti: ${escapeHtml(rootName)}

Odotettiin jotain näistä:
- InfraModel
- IM
- LandXML
</span>`;
    return;
  }

  // 🔹 3. Namespace tarkistus
  const namespace = root.namespaceURI || "ei määritelty";

  if (!namespace || namespace === "") {
    result.innerHTML = `<span class="error">
❌ XML:stä puuttuu namespace

InfraModel vaatii määritellyn namespacen.
</span>`;
    return;
  }

  // 🔹 4. Perusrakenne (esimerkki)
  const hasProject = xmlDoc.getElementsByTagName("Project").length > 0;
  const hasAlignment = xmlDoc.getElementsByTagName("Alignment").length > 0;

  let warnings = [];

  if (!hasProject) {
    warnings.push("⚠️ Project-elementti puuttuu");
  }

  if (!hasAlignment) {
    warnings.push("⚠️ Alignment-elementtiä ei löytynyt");
  }

  // 🔹 Lopputulos
  result.innerHTML = `
<span class="success">✅ XML on hyvin muodostettu ja muistuttaa InfraModel-rakennetta</span>

Root: ${escapeHtml(rootName)}
Namespace: ${escapeHtml(namespace)}

${warnings.length ? warnings.join("\n") : "Ei huomautuksia"}
`;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}