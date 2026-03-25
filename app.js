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
  const infos = [];

  const root = xmlDoc.documentElement;
  const rootName = getLocalName(root);
  const namespace = root.namespaceURI || "";

  validateGeneralStructure(xmlDoc, errors, warnings, infos);

  const detectedType = detectInfraModelContentType(xmlDoc);
  infos.push(`Tunnistettu sisältötyyppi: ${detectedType.label}`);

  validateByDetectedType(xmlDoc, detectedType.key, errors, warnings);

  renderResult({
    result,
    rootName,
    namespace,
    detectedTypeLabel: detectedType.label,
    errors,
    warnings,
    infos
  });
}

function validateGeneralStructure(xmlDoc, errors, warnings, infos) {
  const root = xmlDoc.documentElement;
  const rootName = getLocalName(root);

  if (rootName !== "LandXML" && rootName !== "InfraModel" && rootName !== "IM") {
    errors.push(`Root-elementti ei näytä InfraModel/LandXML-tiedostolta (nyt: ${rootName})`);
  }

  const version =
    root.getAttribute("version") ||
    root.getAttribute("Version") ||
    "";

  if (!version) {
    warnings.push("Juurielementin version-attribuuttia ei löytynyt");
  } else {
    infos.push(`Version-attribuutti: ${version}`);
  }

  if (!root.namespaceURI) {
    warnings.push("Namespace puuttuu juurielementiltä");
  }

  const project = findFirstElement(xmlDoc, "Project");
  if (!project) {
    warnings.push("Project-elementtiä ei löytynyt");
  } else {
    const projectName = project.getAttribute("name");
    if (!projectName) {
      warnings.push("Project-elementiltä puuttuu name-attribuutti");
    }
  }
}

function detectInfraModelContentType(xmlDoc) {
  const hasAlignments = hasElement(xmlDoc, "Alignments") || hasElement(xmlDoc, "Alignment");
  const hasSurfaces = hasElement(xmlDoc, "Surfaces") || hasElement(xmlDoc, "Surface");
  const hasCgPoints = hasElement(xmlDoc, "CgPoints") || hasElement(xmlDoc, "CgPoint");
  const hasPipeNetworks = hasElement(xmlDoc, "PipeNetworks") || hasElement(xmlDoc, "PipeNetwork");
  const hasUnits = hasElement(xmlDoc, "Units");

  if (hasAlignments) {
    return { key: "alignments", label: "linjaus/geometria" };
  }

  if (hasSurfaces) {
    return { key: "surfaces", label: "pintamalli" };
  }

  if (hasPipeNetworks) {
    return { key: "pipes", label: "putki- tai verkostosisältö" };
  }

  if (hasCgPoints) {
    return { key: "points", label: "pisteaineisto" };
  }

  if (hasUnits) {
    return { key: "generic_landxml", label: "yleinen LandXML/InfraModel" };
  }

  return { key: "unknown", label: "ei tunnistettu tarkemmin" };
}

function validateByDetectedType(xmlDoc, typeKey, errors, warnings) {
  switch (typeKey) {
    case "alignments":
      validateAlignmentContent(xmlDoc, errors, warnings);
      break;
    case "surfaces":
      validateSurfaceContent(xmlDoc, errors, warnings);
      break;
    case "pipes":
      validatePipeContent(xmlDoc, errors, warnings);
      break;
    case "points":
      validatePointContent(xmlDoc, errors, warnings);
      break;
    case "generic_landxml":
      validateGenericLandXMLContent(xmlDoc, errors, warnings);
      break;
    case "unknown":
    default:
      warnings.push("Tiedoston tarkkaa InfraModel-sisältötyyppiä ei tunnistettu, joten tehtiin vain yleiset tarkistukset");
      break;
  }
}

function validateAlignmentContent(xmlDoc, errors, warnings) {
  const alignmentList = findElements(xmlDoc, "Alignment");

  if (alignmentList.length === 0) {
    errors.push("Tiedosto näyttää linjausaineistolta, mutta Alignment-elementtejä ei löytynyt");
    return;
  }

  alignmentList.forEach((alignment, index) => {
    const number = index + 1;

    if (!alignment.getAttribute("name")) {
      warnings.push(`Alignment #${number}: name-attribuutti puuttuu`);
    }

    if (!alignment.getAttribute("length")) {
      warnings.push(`Alignment #${number}: length-attribuutti puuttuu`);
    }

    const coordGeom = findFirstChildElement(alignment, "CoordGeom");
    if (!coordGeom) {
      errors.push(`Alignment #${number}: CoordGeom-elementti puuttuu`);
      return;
    }

    const lines = findChildElementsDeep(coordGeom, "Line");
    const curves = findChildElementsDeep(coordGeom, "Curve");
    const spirals = findChildElementsDeep(coordGeom, "Spiral");

    if (lines.length + curves.length + spirals.length === 0) {
      errors.push(`Alignment #${number}: geometria puuttuu (Line/Curve/Spiral)`);
    }

    lines.forEach((line, lineIndex) => {
      if (!line.getAttribute("length")) {
        warnings.push(`Alignment #${number}, Line #${lineIndex + 1}: length-attribuutti puuttuu`);
      }
    });

    curves.forEach((curve, curveIndex) => {
      if (!curve.getAttribute("radius")) {
        warnings.push(`Alignment #${number}, Curve #${curveIndex + 1}: radius-attribuutti puuttuu`);
      }
    });
  });
}

function validateSurfaceContent(xmlDoc, errors, warnings) {
  const surfaces = findElements(xmlDoc, "Surface");

  if (surfaces.length === 0) {
    errors.push("Tiedosto näyttää pintamallilta, mutta Surface-elementtejä ei löytynyt");
    return;
  }

  surfaces.forEach((surface, index) => {
    const number = index + 1;

    if (!surface.getAttribute("name")) {
      warnings.push(`Surface #${number}: name-attribuutti puuttuu`);
    }

    const definition = findFirstChildElement(surface, "Definition");
    if (!definition) {
      warnings.push(`Surface #${number}: Definition-elementtiä ei löytynyt`);
    }

    const pnts =
      findChildElementsDeep(surface, "Pnts").length +
      findChildElementsDeep(surface, "P").length;

    const faces =
      findChildElementsDeep(surface, "Faces").length +
      findChildElementsDeep(surface, "F").length;

    if (pnts === 0) {
      warnings.push(`Surface #${number}: pisteaineistoa ei löytynyt (Pnts/P)`);
    }

    if (faces === 0) {
      warnings.push(`Surface #${number}: pintakolmioita ei löytynyt (Faces/F)`);
    }
  });
}

function validatePipeContent(xmlDoc, errors, warnings) {
  const networks = findElements(xmlDoc, "PipeNetwork");

  if (networks.length === 0) {
    warnings.push("Tiedosto näyttää verkostoaineistolta, mutta PipeNetwork-elementtiä ei löytynyt");
  }

  networks.forEach((network, index) => {
    const number = index + 1;

    if (!network.getAttribute("name")) {
      warnings.push(`PipeNetwork #${number}: name-attribuutti puuttuu`);
    }
  });
}

function validatePointContent(xmlDoc, errors, warnings) {
  const cgPoints = findElements(xmlDoc, "CgPoint");

  if (cgPoints.length === 0) {
    warnings.push("Tiedosto näyttää pisteaineistolta, mutta CgPoint-elementtejä ei löytynyt");
    return;
  }

  cgPoints.forEach((point, index) => {
    const number = index + 1;
    const text = (point.textContent || "").trim();

    if (!text) {
      warnings.push(`CgPoint #${number}: koordinaattisisältö puuttuu`);
    }
  });
}

function validateGenericLandXMLContent(xmlDoc, errors, warnings) {
  const root = xmlDoc.documentElement;

  if (!findFirstChildElement(root, "Units")) {
    warnings.push("Units-elementtiä ei löytynyt juurielementin alta");
  }

  const knownTopLevelNames = [
    "Project",
    "Units",
    "Alignments",
    "Surfaces",
    "PipeNetworks",
    "CgPoints",
    "Parcels",
    "FeatureDictionary"
  ];

  const topLevelChildren = Array.from(root.children).map(getLocalName);
  const matchedKnown = topLevelChildren.filter((name) => knownTopLevelNames.includes(name));

  if (matchedKnown.length === 0) {
    warnings.push("Juurielementin alta ei löytynyt tunnistettuja LandXML/InfraModel-rakenteita");
  }
}

function renderResult({ result, rootName, namespace, detectedTypeLabel, errors, warnings, infos }) {
  const summaryClass = errors.length === 0 ? "success" : "error";
  const summaryText =
    errors.length === 0
      ? "✅ XML läpäisi nykyisen tarkistuksen"
      : "❌ XML:ssä havaittiin validointiongelmia";

  let html = `<span class="${summaryClass}">${summaryText}</span>\n\n`;
  html += `Root: ${escapeHtml(rootName)}\n`;
  html += `Namespace: ${escapeHtml(namespace || "ei määritelty")}\n`;
  html += `Sisältötyyppi: ${escapeHtml(detectedTypeLabel)}\n`;

  if (infos.length) {
    html += `\n<b>Tiedot:</b>\n${escapeHtml(infos.join("\n"))}\n`;
  }

  if (errors.length) {
    html += `\n<b>Virheet:</b>\n${escapeHtml(errors.join("\n"))}\n`;
  }

  if (warnings.length) {
    html += `\n<b>Huomautukset:</b>\n${escapeHtml(warnings.join("\n"))}\n`;
  }

  if (!errors.length && !warnings.length) {
    html += `\nEi huomautuksia.\n`;
  }

  result.innerHTML = html;
}

function hasElement(parent, localName) {
  return findElements(parent, localName).length > 0;
}

function findFirstElement(parent, localName) {
  const elements = findElements(parent, localName);
  return elements.length > 0 ? elements[0] : null;
}

function findElements(parent, localName) {
  return Array.from(parent.getElementsByTagName("*")).filter(
    (element) => getLocalName(element) === localName
  );
}

function findFirstChildElement(parent, localName) {
  return Array.from(parent.children).find(
    (child) => getLocalName(child) === localName
  ) || null;
}

function findChildElementsDeep(parent, localName) {
  return Array.from(parent.getElementsByTagName("*")).filter(
    (element) => getLocalName(element) === localName
  );
}

function getLocalName(element) {
  return element.localName || element.nodeName;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}