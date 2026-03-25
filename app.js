window.validateXML = validateXML;

const VERSION_CONFIG = {
  "4.2.0": {
    label: "InfraModel 4.2.0",
    defaultNamespace: "http://buildingsmart.fi/inframodel/404",
    imNamespace: "http://buildingsmart.fi/im/404",
    schemas: {
      inframodel: "./schemas/4.2.0/inframodel.xsd",
      im: "./schemas/4.2.0/im.xsd"
    }
  },
  "4.1": {
    label: "InfraModel 4.1",
    defaultNamespace: "http://buildingsmart.fi/inframodel/404",
    imNamespace: "http://buildingsmart.fi/im/404",
    schemas: {
      inframodel: "./schemas/4.1/inframodel.xsd",
      im: "./schemas/4.1/im.xsd"
    }
  },
  "4.0.4": {
    label: "InfraModel 4.0.4",
    defaultNamespace: "http://buildingsmart.fi/inframodel/404",
    imNamespace: "http://buildingsmart.fi/im/404",
    schemas: {
      inframodel: "./schemas/4.0.4/inframodel.xsd",
      im: "./schemas/4.0.4/im.xsd"
    }
  }
};

const schemaModelCache = new Map();

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

  const detectedVersion = detectInfraModelVersion(xmlDoc);
  infos.push(`Tunnistettu versio: ${detectedVersion.label}`);

  let schemaModel = null;
  let versionConfig = null;

  if (detectedVersion.key && VERSION_CONFIG[detectedVersion.key]) {
    versionConfig = VERSION_CONFIG[detectedVersion.key];

    try {
      schemaModel = await loadSchemaModelForVersion(detectedVersion.key);
      infos.push(`Version ${detectedVersion.key} skeemat ladattu paikallisesti`);
    } catch (error) {
      warnings.push(`Version ${detectedVersion.key} skeemojen lataus epäonnistui: ${String(error)}`);
    }
  } else {
    warnings.push("Tiedoston versiota ei pystytty tunnistamaan tuettuihin versioihin 4.0.4 / 4.1 / 4.2.0");
  }

  validateGeneralStructure(xmlDoc, versionConfig, errors, warnings, infos);

  const detectedType = detectInfraModelContentType(xmlDoc);
  infos.push(`Tunnistettu sisältötyyppi: ${detectedType.label}`);

  if (schemaModel) {
    validateDocumentAgainstXsdHints(xmlDoc, schemaModel, errors, warnings);
  }

  validateByDetectedType(xmlDoc, detectedType.key, schemaModel, errors, warnings);

  renderResult({
    result,
    rootName,
    namespace,
    detectedTypeLabel: detectedType.label,
    versionLabel: detectedVersion.label,
    errors,
    warnings,
    infos
  });
}

function detectInfraModelVersion(xmlDoc) {
  const root = xmlDoc.documentElement;
  const versionAttr =
    root.getAttribute("version") ||
    root.getAttribute("Version") ||
    "";

  const schemaLocation =
    root.getAttributeNS("http://www.w3.org/2001/XMLSchema-instance", "schemaLocation") ||
    root.getAttribute("xsi:schemaLocation") ||
    "";

  if (versionAttr === "4.2.0" || schemaLocation.includes("/4.2.0/")) {
    return { key: "4.2.0", label: "4.2.0" };
  }

  if (versionAttr === "4.1" || versionAttr === "4.1.0" || schemaLocation.includes("/4.1/") || schemaLocation.includes("/4.1.0/")) {
    return { key: "4.1", label: "4.1" };
  }

  if (versionAttr === "4.0.4" || schemaLocation.includes("/4.0.4/")) {
    return { key: "4.0.4", label: "4.0.4" };
  }

  if (root.namespaceURI === "http://buildingsmart.fi/inframodel/404") {
    return { key: null, label: "InfraModel 4.x (tarkka versio ei selvinnyt)" };
  }

  return { key: null, label: "ei tunnistettu" };
}

function validateGeneralStructure(xmlDoc, versionConfig, errors, warnings, infos) {
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

  const defaultNs = root.namespaceURI || "";
  const imNs = root.getAttribute("xmlns:im") || "";

  if (!defaultNs) {
    errors.push("Namespace puuttuu juurielementiltä");
  } else if (versionConfig && defaultNs !== versionConfig.defaultNamespace) {
    errors.push(
      `Oletusnamespace ei vastaa tunnistetun version skeemaa (nyt: ${defaultNs}, odotettu: ${versionConfig.defaultNamespace})`
    );
  }

  if (versionConfig && imNs && imNs !== versionConfig.imNamespace) {
    warnings.push(
      `im-namespace poikkeaa tunnistetun version odotuksesta (nyt: ${imNs}, odotettu: ${versionConfig.imNamespace})`
    );
  }

  const schemaLocation = root.getAttributeNS(
    "http://www.w3.org/2001/XMLSchema-instance",
    "schemaLocation"
  ) || root.getAttribute("xsi:schemaLocation") || "";

  if (!schemaLocation) {
    warnings.push("xsi:schemaLocation puuttuu");
  } else {
    infos.push("xsi:schemaLocation löytyi");
  }

  const project = findFirstElement(xmlDoc, "Project");
  if (!project) {
    warnings.push("Project-elementtiä ei löytynyt");
  } else {
    if (!project.getAttribute("name")) {
      warnings.push("Project-elementiltä puuttuu name-attribuutti");
    }
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

function validateByDetectedType(xmlDoc, typeKey, schemaModel, errors, warnings) {
  switch (typeKey) {
    case "alignments":
      validateAlignmentContent(xmlDoc, schemaModel, errors, warnings);
      break;
    case "surfaces":
      validateSurfaceContent(xmlDoc, schemaModel, errors, warnings);
      break;
    case "pipes":
      validatePipeContent(xmlDoc, schemaModel, errors, warnings);
      break;
    case "points":
      validatePointContent(xmlDoc, schemaModel, errors, warnings);
      break;
    case "generic_landxml":
      validateGenericLandXMLContent(xmlDoc, schemaModel, errors, warnings);
      break;
    default:
      warnings.push("Tiedoston tarkkaa InfraModel-sisältötyyppiä ei tunnistettu, joten tehtiin vain yleiset tarkistukset");
      break;
  }
}

function validateDocumentAgainstXsdHints(xmlDoc, schemaModel, errors, warnings) {
  const root = xmlDoc.documentElement;
  validateElementWithSchemaRule(root, "LandXML", schemaModel, "LandXML", errors, warnings);

  const project = findFirstElement(xmlDoc, "Project");
  if (project) {
    validateElementWithSchemaRule(project, "Project", schemaModel, "Project", errors, warnings);
  }

  const units = findFirstElement(xmlDoc, "Units");
  if (units) {
    validateElementWithSchemaRule(units, "Units", schemaModel, "Units", errors, warnings);
  }
}

function validateAlignmentContent(xmlDoc, schemaModel, errors, warnings) {
  const alignmentsContainer = findFirstElement(xmlDoc, "Alignments");
  const alignmentList = findElements(xmlDoc, "Alignment");

  if (!alignmentsContainer && alignmentList.length > 0) {
    warnings.push("Alignment-elementtejä löytyi, mutta niitä kokoavaa Alignments-elementtiä ei löytynyt");
  }

  if (alignmentsContainer && schemaModel) {
    validateElementWithSchemaRule(alignmentsContainer, "Alignments", schemaModel, "Alignments", errors, warnings);
  }

  if (alignmentList.length === 0) {
    errors.push("Tiedosto näyttää linjausaineistolta, mutta Alignment-elementtejä ei löytynyt");
    return;
  }

  alignmentList.forEach((alignment, index) => {
    const number = index + 1;

    if (schemaModel) {
      validateElementWithSchemaRule(alignment, "Alignment", schemaModel, `Alignment #${number}`, errors, warnings);
    }

    const coordGeom = findFirstChildElement(alignment, "CoordGeom");
    if (!coordGeom) {
      errors.push(`Alignment #${number}: pakollinen CoordGeom-elementti puuttuu`);
      return;
    }

    const lines = findChildElementsDeep(coordGeom, "Line");
    const curves = findChildElementsDeep(coordGeom, "Curve");
    const spirals = findChildElementsDeep(coordGeom, "Spiral");

    if (lines.length + curves.length + spirals.length === 0) {
      errors.push(`Alignment #${number}: CoordGeom ei sisällä geometriaelementtejä (Line/Curve/Spiral)`);
    }
  });
}

function validateSurfaceContent(xmlDoc, schemaModel, errors, warnings) {
  const surfaces = findElements(xmlDoc, "Surface");

  if (surfaces.length === 0) {
    errors.push("Tiedosto näyttää pintamallilta, mutta Surface-elementtejä ei löytynyt");
    return;
  }

  surfaces.forEach((surface, index) => {
    const number = index + 1;

    if (schemaModel) {
      validateElementWithSchemaRule(surface, "Surface", schemaModel, `Surface #${number}`, errors, warnings);
    }

    const definition = findFirstChildElement(surface, "Definition");
    if (!definition) {
      errors.push(`Surface #${number}: pakollinen Definition-elementti puuttuu`);
      return;
    }
  });
}

function validatePipeContent(xmlDoc, schemaModel, errors, warnings) {
  const networks = findElements(xmlDoc, "PipeNetwork");

  if (networks.length === 0) {
    errors.push("Tiedosto näyttää verkostoaineistolta, mutta PipeNetwork-elementtejä ei löytynyt");
    return;
  }

  networks.forEach((network, index) => {
    const number = index + 1;

    if (schemaModel) {
      validateElementWithSchemaRule(network, "PipeNetwork", schemaModel, `PipeNetwork #${number}`, errors, warnings);
    }
  });
}

function validatePointContent(xmlDoc, schemaModel, errors, warnings) {
  const cgPoints = findElements(xmlDoc, "CgPoint");

  if (cgPoints.length === 0) {
    errors.push("Tiedosto näyttää pisteaineistolta, mutta CgPoint-elementtejä ei löytynyt");
    return;
  }

  cgPoints.forEach((point, index) => {
    const number = index + 1;

    if (schemaModel) {
      validateElementWithSchemaRule(point, "CgPoint", schemaModel, `CgPoint #${number}`, errors, warnings);
    }

    const text = normalizeWhitespace(point.textContent);
    if (!text) {
      errors.push(`CgPoint #${number}: koordinaattisisältö puuttuu`);
    }
  });
}

function validateGenericLandXMLContent(xmlDoc, schemaModel, errors, warnings) {
  const root = xmlDoc.documentElement;

  if (!findFirstChildElement(root, "Units")) {
    warnings.push("Units-elementtiä ei löytynyt juurielementin alta");
  }

  if (schemaModel) {
    validateElementWithSchemaRule(root, "LandXML", schemaModel, "LandXML", errors, warnings);
  }
}

async function loadSchemaModelForVersion(versionKey) {
  if (schemaModelCache.has(versionKey)) {
    return schemaModelCache.get(versionKey);
  }

  const config = VERSION_CONFIG[versionKey];
  if (!config) {
    throw new Error(`Tuntematon versio: ${versionKey}`);
  }

  const docs = await Promise.all([
    loadXmlDocument(config.schemas.inframodel, `inframodel.xsd (${versionKey})`),
    loadXmlDocument(config.schemas.im, `im.xsd (${versionKey})`)
  ]);

  const model = buildSchemaModel(docs);
  schemaModelCache.set(versionKey, model);
  return model;
}

async function loadXmlDocument(url, label) {
  const response = await fetch(url, { cache: "force-cache" });

  if (!response.ok) {
    throw new Error(`${label} lataus epäonnistui (${response.status})`);
  }

  const text = await response.text();
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const parseError = doc.querySelector("parsererror");

  if (parseError) {
    throw new Error(`${label} ei ole kelvollinen XML`);
  }

  return doc;
}

function buildSchemaModel(xsdDocs) {
  const model = {
    globalElements: new Map(),
    complexTypes: new Map(),
    resolvedRules: new Map()
  };

  xsdDocs.forEach((doc) => {
    const allNodes = Array.from(doc.getElementsByTagName("*"));

    allNodes.forEach((node) => {
      const localName = getLocalName(node);
      const parentLocalName = node.parentElement ? getLocalName(node.parentElement) : "";

      if (
        parentLocalName === "schema" &&
        localName === "element" &&
        node.getAttribute("name") &&
        isValidXmlName(node.getAttribute("name"))
      ) {
        model.globalElements.set(node.getAttribute("name"), node);
      }

      if (
        parentLocalName === "schema" &&
        localName === "complexType" &&
        node.getAttribute("name") &&
        isValidXmlName(node.getAttribute("name"))
      ) {
        model.complexTypes.set(node.getAttribute("name"), node);
      }
    });
  });

  return model;
}

function getSchemaRule(elementName, schemaModel) {
  if (!schemaModel) {
    return null;
  }

  if (schemaModel.resolvedRules.has(elementName)) {
    return schemaModel.resolvedRules.get(elementName);
  }

  const globalElement = schemaModel.globalElements.get(elementName);
  if (!globalElement) {
    schemaModel.resolvedRules.set(elementName, null);
    return null;
  }

  const rule = resolveElementRule(globalElement, schemaModel, new Set());
  schemaModel.resolvedRules.set(elementName, rule);
  return rule;
}

function resolveElementRule(elementNode, schemaModel, visitedTypeNames) {
  const rule = {
    requiredAttributes: [],
    requiredChildren: [],
    requiredChoices: []
  };

  const typeName = localTypeName(elementNode.getAttribute("type"));
  let complexTypeNode = findDirectChild(elementNode, "complexType");

  if (!complexTypeNode && typeName && schemaModel.complexTypes.has(typeName)) {
    complexTypeNode = schemaModel.complexTypes.get(typeName);
  }

  if (!complexTypeNode) {
    return rule;
  }

  const complexRule = resolveComplexTypeRule(complexTypeNode, schemaModel, visitedTypeNames);
  mergeRuleInto(rule, complexRule);

  return normalizeRule(rule);
}

function resolveComplexTypeRule(complexTypeNode, schemaModel, visitedTypeNames) {
  const rule = {
    requiredAttributes: [],
    requiredChildren: [],
    requiredChoices: []
  };

  const typeName = complexTypeNode.getAttribute("name") || "";
  if (typeName) {
    if (visitedTypeNames.has(typeName)) {
      return rule;
    }
    visitedTypeNames.add(typeName);
  }

  Array.from(complexTypeNode.children).forEach((child) => {
    const childName = getLocalName(child);

    if (childName === "attribute") {
      const attrName = child.getAttribute("name");
      if (child.getAttribute("use") === "required" && attrName && isValidXmlName(attrName)) {
        rule.requiredAttributes.push(attrName);
      }
      return;
    }

    if (childName === "sequence" || childName === "all") {
      parseModelGroup(child, rule, false);
      return;
    }

    if (childName === "choice") {
      parseModelGroup(child, rule, true);
      return;
    }

    if (childName === "complexContent") {
      const extension = findDirectChild(child, "extension");
      if (extension) {
        const baseName = localTypeName(extension.getAttribute("base"));
        if (baseName && schemaModel.complexTypes.has(baseName)) {
          const baseRule = resolveComplexTypeRule(
            schemaModel.complexTypes.get(baseName),
            schemaModel,
            visitedTypeNames
          );
          mergeRuleInto(rule, baseRule);
        }

        Array.from(extension.children).forEach((extChild) => {
          const extName = getLocalName(extChild);

          if (extName === "attribute") {
            const attrName = extChild.getAttribute("name");
            if (extChild.getAttribute("use") === "required" && attrName && isValidXmlName(attrName)) {
              rule.requiredAttributes.push(attrName);
            }
          }

          if (extName === "sequence" || extName === "all") {
            parseModelGroup(extChild, rule, false);
          }

          if (extName === "choice") {
            parseModelGroup(extChild, rule, true);
          }
        });
      }
    }
  });

  return normalizeRule(rule);
}

function parseModelGroup(groupNode, rule, treatAsChoice) {
  const requiredChoice = [];

  Array.from(groupNode.children).forEach((child) => {
    const childName = getLocalName(child);

    if (childName === "element") {
      const minOccurs = parseOccurs(child.getAttribute("minOccurs"), 1);
      const isRequired = minOccurs > 0;
      const targetName = child.getAttribute("name") || localTypeName(child.getAttribute("ref"));

      if (!targetName || !isValidXmlName(targetName)) {
        return;
      }

      if (treatAsChoice) {
        if (isRequired) {
          requiredChoice.push(targetName);
        }
      } else if (isRequired) {
        rule.requiredChildren.push(targetName);
      }
      return;
    }

    if (childName === "sequence" || childName === "all") {
      parseModelGroup(child, rule, false);
      return;
    }

    if (childName === "choice") {
      parseModelGroup(child, rule, true);
    }
  });

  if (requiredChoice.length > 0) {
    rule.requiredChoices.push(requiredChoice);
  }
}

function validateElementWithSchemaRule(xmlElement, schemaElementName, schemaModel, label, errors, warnings) {
  const rule = getSchemaRule(schemaElementName, schemaModel);
  if (!rule) {
    return;
  }

  rule.requiredAttributes.forEach((attrName) => {
    if (!xmlElement.hasAttribute(attrName)) {
      warnings.push(`${label}: XSD:n mukaan pakollinen attribuutti puuttuu: ${attrName}`);
    }
  });

  rule.requiredChildren.forEach((childName) => {
    if (!findFirstChildElement(xmlElement, childName)) {
      errors.push(`${label}: XSD:n mukaan pakollinen alielementti puuttuu: ${childName}`);
    }
  });

  rule.requiredChoices.forEach((choiceNames) => {
    const found = choiceNames.some((name) => findFirstChildElement(xmlElement, name));
    if (!found) {
      errors.push(`${label}: XSD:n mukaan vähintään yksi näistä alielementeistä vaaditaan: ${choiceNames.join(", ")}`);
    }
  });
}

function isValidXmlName(value) {
  return /^[A-Za-z_][A-Za-z0-9._-]*$/.test(String(value || ""));
}

function parseOccurs(value, defaultValue) {
  if (value === null || value === undefined || value === "") {
    return defaultValue;
  }
  if (value === "unbounded") {
    return Infinity;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function localTypeName(value) {
  if (!value) {
    return "";
  }
  const parts = value.split(":");
  return parts[parts.length - 1];
}

function normalizeRule(rule) {
  return {
    requiredAttributes: unique(rule.requiredAttributes),
    requiredChildren: unique(rule.requiredChildren),
    requiredChoices: rule.requiredChoices.map((group) => unique(group)).filter((group) => group.length > 0)
  };
}

function mergeRuleInto(target, source) {
  target.requiredAttributes.push(...source.requiredAttributes);
  target.requiredChildren.push(...source.requiredChildren);
  target.requiredChoices.push(...source.requiredChoices);
}

function unique(values) {
  return Array.from(new Set(values));
}

function findDirectChild(parent, localName) {
  return Array.from(parent.children).find((child) => getLocalName(child) === localName) || null;
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

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function renderResult({ result, rootName, namespace, detectedTypeLabel, versionLabel, errors, warnings, infos }) {
  const summaryClass = errors.length === 0 ? "success" : "error";
  const summaryText =
    errors.length === 0
      ? "✅ XML läpäisi nykyisen tarkistuksen"
      : "❌ XML:ssä havaittiin validointiongelmia";

  let html = `<span class="${summaryClass}">${summaryText}</span>\n\n`;
  html += `Root: ${escapeHtml(rootName)}\n`;
  html += `Namespace: ${escapeHtml(namespace || "ei määritelty")}\n`;
  html += `Versio: ${escapeHtml(versionLabel)}\n`;
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