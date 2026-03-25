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

  const errors = [];
  const warnings = [];

  const root = xmlDoc.documentElement;
  const rootName = root.nodeName;

  // 🔹 1. Root tarkistus
  if (rootName !== "LandXML") {
    errors.push(`Root-elementti ei ole LandXML (nyt: ${rootName})`);
  }

  // 🔹 2. Namespace
  const namespace = root.namespaceURI;
  if (!namespace) {
    errors.push("Namespace puuttuu");
  }

  // 🔹 3. Project
  const project = xmlDoc.getElementsByTagName("Project")[0];
  if (!project) {
    errors.push("Project-elementti puuttuu");
  } else {
    if (!project.getAttribute("name")) {
      warnings.push("Project: name-attribuutti puuttuu");
    }
  }

  // 🔹 4. Alignments
  const alignments = xmlDoc.getElementsByTagName("Alignments")[0];
  if (!alignments) {
    errors.push("Alignments-elementti puuttuu");
  }

  const alignmentList = xmlDoc.getElementsByTagName("Alignment");

  if (alignmentList.length === 0) {
    errors.push("Yhtään Alignment-elementtiä ei löytynyt");
  }

  // 🔹 5. Alignment tarkistukset
  for (let i = 0; i < alignmentList.length; i++) {
    const alignment = alignmentList[i];

    if (!alignment.getAttribute("name")) {
      warnings.push(`Alignment #${i + 1}: name puuttuu`);
    }

    if (!alignment.getAttribute("length")) {
      warnings.push(`Alignment #${i + 1}: length puuttuu`);
    }

    const coordGeom = alignment.getElementsByTagName("CoordGeom")[0];

    if (!coordGeom) {
      errors.push(`Alignment #${i + 1}: CoordGeom puuttuu`);
      continue;
    }

    // 🔹 Geometry tarkistus
    const lines = coordGeom.getElementsByTagName("Line");
    const curves = coordGeom.getElementsByTagName("Curve");
    const spirals = coordGeom.getElementsByTagName("Spiral");

    const totalGeom = lines.length + curves.length + spirals.length;

    if (totalGeom === 0) {
      errors.push(`Alignment #${i + 1}: ei sisällä geometriaa (Line/Curve/Spiral)`);
    }

    // 🔹 tarkista yksittäiset Line-elementit
    for (let j = 0; j < lines.length; j++) {
      const line = lines[j];

      if (!line.getAttribute("length")) {
        warnings.push(`Alignment #${i + 1} Line #${j + 1}: length puuttuu`);
      }
    }

    // 🔹 tarkista Curve-elementit
    for (let j = 0; j < curves.length; j++) {
      const curve = curves[j];

      if (!curve.getAttribute("radius")) {
        warnings.push(`Alignment #${i + 1} Curve #${j + 1}: radius puuttuu`);
      }
    }
  }

  // 🔹 Lopputulos
  if (errors.length === 0) {
    result.innerHTML = `
<span class="success">✅ XML läpäisi InfraModel-tyyppisen tarkistuksen</span>

Root: ${escapeHtml(rootName)}
Namespace: ${escapeHtml(namespace)}

${warnings.length ? "<b>Huomautukset:</b>\n" + warnings.join("\n") : "Ei huomautuksia"}
`;
  } else {
    result.innerHTML = `
<span class="error">❌ XML ei ole InfraModel-yhteensopiva</span>

<b>Virheet:</b>
${errors.join("\n")}

${warnings.length ? "\n<b>Huomautukset:</b>\n" + warnings.join("\n") : ""}
`;
  }
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}