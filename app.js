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

const SUPPORTED_DEFAULT_NAMESPACES = Array.from(
  new Set(Object.values(VERSION_CONFIG).map((cfg) => cfg.defaultNamespace))
);

const SUPPORTED_IM_NAMESPACES = Array.from(
  new Set(Object.values(VERSION_CONFIG).map((cfg) => cfg.imNamespace))
);

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
      warnings.push(createIssue(`Version ${detectedVersion.key} skeemojen lataus epäonnistui: ${String(error)}`));
    }
  } else {
    warnings.push(createIssue("Tiedoston versiota ei pystytty tunnistamaan tuettuihin versioihin 4.0.4 / 4.1 / 4.2.0"));
  }

  validateGeneralStructure(xmlDoc, xmlText, versionConfig, errors, warnings, infos);

  const detectedType = detectInfraModelContentType(xmlDoc);
  infos.push(`Tunnistettu sisältötyyppi: ${detectedType.label}`);

  if (schemaModel) {
    validateDocumentAgainstXsdHints(xmlDoc, xmlText, schemaModel, errors, warnings);
  }

  validateByDetectedType(xmlDoc, xmlText, detectedType.key, schemaModel, errors, warnings);
  validateApplicationGuidelineRules(xmlDoc, xmlText, detectedType.key, errors, warnings);

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

  if (
    versionAttr === "4.1" ||
    versionAttr === "4.1.0" ||
    schemaLocation.includes("/4.1/") ||
    schemaLocation.includes("/4.1.0/")
  ) {
    return { key: "4.1", label: "4.1" };
  }

  if (versionAttr === "4.0.4" || schemaLocation.includes("/4.0.4/")) {
    return { key: "4.0.4", label: "4.0.4" };
  }

  if (SUPPORTED_DEFAULT_NAMESPACES.includes(root.namespaceURI || "")) {
    return { key: null, label: "InfraModel 4.x (tarkka versio ei selvinnyt)" };
  }

  return { key: null, label: "ei tunnistettu" };
}

function validateGeneralStructure(xmlDoc, xmlText, versionConfig, errors, warnings, infos) {
  const root = xmlDoc.documentElement;
  const rootName = getLocalName(root);

  if (rootName !== "LandXML") {
    errors.push(createIssue(`Root-elementin tulee olla LandXML (nyt: ${rootName})`, root, xmlText));
  }

  const version =
    root.getAttribute("version") ||
    root.getAttribute("Version") ||
    "";

  if (!version) {
    warnings.push(createIssue("Juurielementin version-attribuuttia ei löytynyt", root, xmlText, { attributeName: "version" }));
  } else {
    infos.push(`Version-attribuutti: ${version}`);
  }

  const defaultNs = root.namespaceURI || "";
  const imNs = root.getAttribute("xmlns:im") || "";

  if (!defaultNs) {
    errors.push(createIssue("Namespace puuttuu juurielementiltä", root, xmlText));
  } else if (!SUPPORTED_DEFAULT_NAMESPACES.includes(defaultNs)) {
    errors.push(
      createIssue(
        `Oletusnamespace ei ole tuettu InfraModel-namespace (nyt: ${defaultNs}, odotettu yksi näistä: ${SUPPORTED_DEFAULT_NAMESPACES.join(", ")})`,
        root,
        xmlText
      )
    );
  } else if (versionConfig && defaultNs !== versionConfig.defaultNamespace) {
    errors.push(
      createIssue(
        `Oletusnamespace ei vastaa tunnistetun version skeemaa (nyt: ${defaultNs}, odotettu: ${versionConfig.defaultNamespace})`,
        root,
        xmlText
      )
    );
  }

  if (imNs) {
    if (!SUPPORTED_IM_NAMESPACES.includes(imNs)) {
      warnings.push(
        createIssue(
          `im-namespace ei ole tuettu InfraModel im-namespace (nyt: ${imNs}, odotettu yksi näistä: ${SUPPORTED_IM_NAMESPACES.join(", ")})`,
          root,
          xmlText
        )
      );
    } else if (versionConfig && imNs !== versionConfig.imNamespace) {
      warnings.push(
        createIssue(
          `im-namespace poikkeaa tunnistetun version odotuksesta (nyt: ${imNs}, odotettu: ${versionConfig.imNamespace})`,
          root,
          xmlText
        )
      );
    }
  }

  const schemaLocation = root.getAttributeNS(
    "http://www.w3.org/2001/XMLSchema-instance",
    "schemaLocation"
  ) || root.getAttribute("xsi:schemaLocation") || "";

  if (!schemaLocation) {
    warnings.push(createIssue("xsi:schemaLocation puuttuu", root, xmlText, { attributeName: "xsi:schemaLocation" }));
  } else {
    infos.push("xsi:schemaLocation löytyi");
  }

  const units = findFirstElement(xmlDoc, "Units");
  if (!units) {
    errors.push(createIssue("Units-elementti puuttuu", root, xmlText, { childName: "Units" }));
  }

  const project = findFirstElement(xmlDoc, "Project");
  if (!project) {
    warnings.push(createIssue("Project-elementtiä ei löytynyt", root, xmlText, { childName: "Project" }));
  } else if (!project.getAttribute("name")) {
    warnings.push(createIssue("Project-elementiltä puuttuu name-attribuutti", project, xmlText, { attributeName: "name" }));
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
    warnings.push(createIssue("Juurielementin alta ei löytynyt tunnistettuja LandXML/InfraModel-rakenteita", root, xmlText));
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

function validateByDetectedType(xmlDoc, xmlText, typeKey, schemaModel, errors, warnings) {
  switch (typeKey) {
    case "alignments":
      validateAlignmentContent(xmlDoc, xmlText, schemaModel, errors, warnings);
      break;
    case "surfaces":
      validateSurfaceContent(xmlDoc, xmlText, schemaModel, errors, warnings);
      break;
    case "pipes":
      validatePipeContent(xmlDoc, xmlText, schemaModel, errors, warnings);
      break;
    case "points":
      validatePointContent(xmlDoc, xmlText, schemaModel, errors, warnings);
      break;
    case "generic_landxml":
      validateGenericLandXMLContent(xmlDoc, xmlText, schemaModel, errors, warnings);
      break;
    default:
      warnings.push(createIssue("Tiedoston tarkkaa InfraModel-sisältötyyppiä ei tunnistettu, joten tehtiin vain yleiset tarkistukset"));
      break;
  }
}

function validateApplicationGuidelineRules(xmlDoc, xmlText, typeKey, errors, warnings) {
  validateUnitsContent(xmlDoc, xmlText, warnings);

  if (typeKey === "surfaces") {
    validateSurfaceGuidelineRules(xmlDoc, xmlText, errors, warnings);
  }
}

function validateUnitsContent(xmlDoc, xmlText, warnings) {
  const units = findFirstElement(xmlDoc, "Units");
  if (!units) {
    return;
  }

  const metric = findFirstChildElement(units, "Metric");
  if (!metric) {
    warnings.push(createIssue("Units-elementin alta puuttuu Metric", units, xmlText, { childName: "Metric" }));
    return;
  }

  const recommendedAttrs = [
    "areaUnit",
    "linearUnit",
    "volumeUnit",
    "temperatureUnit",
    "pressureUnit",
    "diameterUnit",
    "weightUnit",
    "velocityUnit",
    "directionUnit",
    "angularUnit"
  ];

  recommendedAttrs.forEach((attrName) => {
    if (!metric.hasAttribute(attrName)) {
      warnings.push(createIssue(`Units/Metric: suositeltu attribuutti puuttuu: ${attrName}`, metric, xmlText, { attributeName: attrName }));
    }
  });
}

function validateSurfaceGuidelineRules(xmlDoc, xmlText, errors, warnings) {
  const surfaces = findElements(xmlDoc, "Surface");

  surfaces.forEach((surface, surfaceIndex) => {
    const surfaceNo = surfaceIndex + 1;
    const definition = findFirstChildElement(surface, "Definition");

    if (!definition) {
      return;
    }

    const dataPointsGroups = findChildElementsDeep(surface, "DataPoints");
    const dataPoints = findChildElementsDeep(surface, "DataPoint");
    const breakLinesGroups = findChildElementsDeep(surface, "BreakLines");
    const breakLines = findChildElementsDeep(surface, "BreakLine");

    if (dataPointsGroups.length > 0 || dataPoints.length > 0) {
      validateSurfaceSourceDataCoding(
        dataPointsGroups.length > 0 ? dataPointsGroups : dataPoints,
        `Surface #${surfaceNo} DataPoints`,
        xmlText,
        warnings
      );
    }

    if (breakLinesGroups.length > 0 || breakLines.length > 0) {
      validateSurfaceBreakLineCoding(
        breakLinesGroups.length > 0 ? breakLinesGroups : breakLines,
        `Surface #${surfaceNo} BreakLines`,
        xmlText,
        warnings
      );
    }

    const surfaceCodingFeature = findDirectFeatureByCode(surface, "IM_coding");
    if (!surfaceCodingFeature) {
      warnings.push(createIssue(`Surface #${surfaceNo}: IM_coding-Feature puuttuu`, surface, xmlText));
    } else {
      const keys = extractDirectPropertyKeys(surfaceCodingFeature);
      const surfaceCodingValue = findDirectPropertyValue(surfaceCodingFeature, "surfaceCoding");
      const surfaceCodingDescValue = findDirectPropertyValue(surfaceCodingFeature, "surfaceCodingDesc");

      if (!keys.includes("surfaceCoding")) {
        warnings.push(createIssue(`Surface #${surfaceNo}: surfaceCoding puuttuu IM_coding-Featureltä`, surfaceCodingFeature, xmlText));
      } else if (!isSixDigitCode(surfaceCodingValue)) {
        warnings.push(
          createIssue(
            `Surface #${surfaceNo}: surfaceCoding ei ole kuusinumeroinen arvo (arvo: ${formatPropertyValue(surfaceCodingValue)})`,
            surfaceCodingFeature,
            xmlText
          )
        );
      }

      if (!keys.includes("surfaceCodingDesc")) {
        warnings.push(createIssue(`Surface #${surfaceNo}: surfaceCodingDesc puuttuu IM_coding-Featureltä`, surfaceCodingFeature, xmlText));
      } else if (!surfaceCodingDescValue) {
        warnings.push(createIssue(`Surface #${surfaceNo}: surfaceCodingDesc on tyhjä`, surfaceCodingFeature, xmlText));
      }
    }

    const pntsNode = findFirstDeepChildElement(definition, "Pnts");
    const facesNode = findFirstDeepChildElement(definition, "Faces");

    if (!pntsNode) {
      errors.push(createIssue(`Surface #${surfaceNo}: Definition-elementin alta puuttuu Pnts`, definition, xmlText, { childName: "Pnts" }));
    }
    if (!facesNode) {
      errors.push(createIssue(`Surface #${surfaceNo}: Definition-elementin alta puuttuu Faces`, definition, xmlText, { childName: "Faces" }));
    }
  });
}

function validateSurfaceSourceDataCoding(nodes, labelPrefix, xmlText, warnings) {
  nodes.forEach((node, index) => {
    const itemNo = index + 1;
    const codingFeature = findDirectFeatureByCode(node, "IM_coding");

    if (!codingFeature) {
      warnings.push(createIssue(`${labelPrefix} #${itemNo}: IM_coding-Feature puuttuu`, node, xmlText));
      return;
    }

    const keys = extractDirectPropertyKeys(codingFeature);

    if (!keys.includes("terrainCoding")) {
      warnings.push(createIssue(`${labelPrefix} #${itemNo}: terrainCoding puuttuu IM_coding-Featureltä`, codingFeature, xmlText));
    }

    if (!keys.includes("terrainCodingDesc")) {
      warnings.push(createIssue(`${labelPrefix} #${itemNo}: terrainCodingDesc puuttuu IM_coding-Featureltä`, codingFeature, xmlText));
    }

    if (!keys.includes("surfaceCoding")) {
      warnings.push(createIssue(`${labelPrefix} #${itemNo}: surfaceCoding puuttuu (valinnainen, ilmoitetaan huomautuksena)`, codingFeature, xmlText));
    }
  });
}

function validateSurfaceBreakLineCoding(nodes, labelPrefix, xmlText, warnings) {
  nodes.forEach((node, index) => {
    const itemNo = index + 1;

    if (getLocalName(node) === "BreakLines") {
      const breakLines = findDirectChildren(node, "BreakLine");
      breakLines.forEach((breakLine, breakLineIndex) => {
        validateSingleBreakLineCoding(
          breakLine,
          `${labelPrefix} #${itemNo} / BreakLine #${breakLineIndex + 1}`,
          xmlText,
          warnings
        );
      });
      return;
    }

    validateSingleBreakLineCoding(node, `${labelPrefix} #${itemNo}`, xmlText, warnings);
  });
}

function validateSingleBreakLineCoding(breakLineNode, labelPrefix, xmlText, warnings) {
  const codingFeature = findDirectFeatureByCode(breakLineNode, "IM_coding");

  if (!codingFeature) {
    warnings.push(createIssue(`${labelPrefix}: IM_coding-Feature puuttuu`, breakLineNode, xmlText));
    return;
  }

  const keys = extractDirectPropertyKeys(codingFeature);
  const infraCodingValue = findDirectPropertyValue(codingFeature, "infraCoding");
  const terrainCodingValue = findDirectPropertyValue(codingFeature, "terrainCoding");
  const terrainCodingDescValue = findDirectPropertyValue(codingFeature, "terrainCodingDesc");

  if (!keys.includes("infraCoding")) {
    warnings.push(createIssue(`${labelPrefix}: infraCoding puuttuu IM_coding-Featureltä`, codingFeature, xmlText));
  } else if (!isThreeDigitCode(infraCodingValue)) {
    warnings.push(
      createIssue(
        `${labelPrefix}: infraCoding ei ole kolminumeroinen arvo (arvo: ${formatPropertyValue(infraCodingValue)})`,
        codingFeature,
        xmlText
      )
    );
  }

  if (!keys.includes("terrainCoding")) {
    warnings.push(createIssue(`${labelPrefix}: terrainCoding puuttuu IM_coding-Featureltä`, codingFeature, xmlText));
  } else if (!terrainCodingValue) {
    warnings.push(createIssue(`${labelPrefix}: terrainCoding on tyhjä`, codingFeature, xmlText));
  }

  if (!keys.includes("terrainCodingDesc")) {
    warnings.push(createIssue(`${labelPrefix}: terrainCodingDesc puuttuu IM_coding-Featureltä`, codingFeature, xmlText));
  } else if (!terrainCodingDescValue) {
    warnings.push(createIssue(`${labelPrefix}: terrainCodingDesc on tyhjä`, codingFeature, xmlText));
  }
}

function extractDirectPropertyKeys(featureNode) {
  return findDirectChildren(featureNode, "Property")
    .map((property) => getPropertyKey(property))
    .filter(Boolean);
}

function findDirectPropertyValue(featureNode, key) {
  const property = findDirectChildren(featureNode, "Property").find(
    (node) => getPropertyKey(node) === key
  );

  if (!property) {
    return "";
  }

  return getPropertyValue(property);
}

function getPropertyKey(propertyNode) {
  return (
    propertyNode.getAttribute("label") ||
    propertyNode.getAttribute("name") ||
    propertyNode.getAttribute("code") ||
    ""
  ).trim();
}

function getPropertyValue(propertyNode) {
  return (
    propertyNode.getAttribute("value") ||
    propertyNode.getAttribute("val") ||
    normalizeWhitespace(propertyNode.textContent) ||
    ""
  ).trim();
}

function formatPropertyValue(value) {
  return value && value.length ? value : "puuttuu";
}

function isThreeDigitCode(value) {
  return /^\d{3}$/.test(String(value || "").trim());
}

function isSixDigitCode(value) {
  return /^\d{6}$/.test(String(value || "").trim());
}

function validateDocumentAgainstXsdHints(xmlDoc, xmlText, schemaModel, errors, warnings) {
  const root = xmlDoc.documentElement;
  validateElementWithSchemaRule(root, "LandXML", xmlText, schemaModel, "LandXML", errors, warnings);

  const project = findFirstElement(xmlDoc, "Project");
  if (project) {
    validateElementWithSchemaRule(project, "Project", xmlText, schemaModel, "Project", errors, warnings);
  }

  const units = findFirstElement(xmlDoc, "Units");
  if (units) {
    validateElementWithSchemaRule(units, "Units", xmlText, schemaModel, "Units", errors, warnings);
  }
}

function validateAlignmentContent(xmlDoc, xmlText, schemaModel, errors, warnings) {
  const alignmentsContainer = findFirstElement(xmlDoc, "Alignments");
  const alignmentList = findElements(xmlDoc, "Alignment");

  if (!alignmentsContainer && alignmentList.length > 0) {
    warnings.push(createIssue("Alignment-elementtejä löytyi, mutta niitä kokoavaa Alignments-elementtiä ei löytynyt", alignmentList[0], xmlText));
  }

  if (alignmentsContainer && schemaModel) {
    validateElementWithSchemaRule(alignmentsContainer, "Alignments", xmlText, schemaModel, "Alignments", errors, warnings);
  }

  if (alignmentList.length === 0) {
    errors.push(createIssue("Tiedosto näyttää linjausaineistolta, mutta Alignment-elementtejä ei löytynyt", xmlDoc.documentElement, xmlText));
    return;
  }

  alignmentList.forEach((alignment, index) => {
    const number = index + 1;

    if (schemaModel) {
      validateElementWithSchemaRule(alignment, "Alignment", xmlText, schemaModel, `Alignment #${number}`, errors, warnings);
    }

    const coordGeom = findFirstChildElement(alignment, "CoordGeom");
    if (!coordGeom) {
      errors.push(createIssue(`Alignment #${number}: pakollinen CoordGeom-elementti puuttuu`, alignment, xmlText, { childName: "CoordGeom" }));
      return;
    }

    const lines = findChildElementsDeep(coordGeom, "Line");
    const curves = findChildElementsDeep(coordGeom, "Curve");
    const spirals = findChildElementsDeep(coordGeom, "Spiral");

    if (lines.length + curves.length + spirals.length === 0) {
      errors.push(createIssue(`Alignment #${number}: CoordGeom ei sisällä geometriaelementtejä (Line/Curve/Spiral)`, coordGeom, xmlText));
    }
  });
}

function validateSurfaceContent(xmlDoc, xmlText, schemaModel, errors, warnings) {
  const surfaces = findElements(xmlDoc, "Surface");

  if (surfaces.length === 0) {
    errors.push(createIssue("Tiedosto näyttää pintamallilta, mutta Surface-elementtejä ei löytynyt", xmlDoc.documentElement, xmlText));
    return;
  }

  surfaces.forEach((surface, index) => {
    const number = index + 1;

    if (schemaModel) {
      validateElementWithSchemaRule(surface, "Surface", xmlText, schemaModel, `Surface #${number}`, errors, warnings);
    }

    const definition = findFirstChildElement(surface, "Definition");
    if (!definition) {
      errors.push(createIssue(`Surface #${number}: pakollinen Definition-elementti puuttuu`, surface, xmlText, { childName: "Definition" }));
    }
  });
}

function validatePipeContent(xmlDoc, xmlText, schemaModel, errors, warnings) {
  const networks = findElements(xmlDoc, "PipeNetwork");

  if (networks.length === 0) {
    errors.push(createIssue("Tiedosto näyttää verkostoaineistolta, mutta PipeNetwork-elementtejä ei löytynyt", xmlDoc.documentElement, xmlText));
    return;
  }

  networks.forEach((network, index) => {
    const number = index + 1;

    if (schemaModel) {
      validateElementWithSchemaRule(network, "PipeNetwork", xmlText, schemaModel, `PipeNetwork #${number}`, errors, warnings);
    }
  });
}

function validatePointContent(xmlDoc, xmlText, schemaModel, errors, warnings) {
  const cgPoints = findElements(xmlDoc, "CgPoint");

  if (cgPoints.length === 0) {
    errors.push(createIssue("Tiedosto näyttää pisteaineistolta, mutta CgPoint-elementtejä ei löytynyt", xmlDoc.documentElement, xmlText));
    return;
  }

  cgPoints.forEach((point, index) => {
    const number = index + 1;

    if (schemaModel) {
      validateElementWithSchemaRule(point, "CgPoint", xmlText, schemaModel, `CgPoint #${number}`, errors, warnings);
    }

    const text = normalizeWhitespace(point.textContent);
    if (!text) {
      errors.push(createIssue(`CgPoint #${number}: koordinaattisisältö puuttuu`, point, xmlText));
    }
  });
}

function validateGenericLandXMLContent(xmlDoc, xmlText, schemaModel, errors, warnings) {
  const root = xmlDoc.documentElement;

  if (!findFirstChildElement(root, "Units")) {
    warnings.push(createIssue("Units-elementtiä ei löytynyt juurielementin alta", root, xmlText, { childName: "Units" }));
  }

  if (schemaModel) {
    validateElementWithSchemaRule(root, "LandXML", xmlText, schemaModel, "LandXML", errors, warnings);
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

function validateElementWithSchemaRule(xmlElement, schemaElementName, xmlText, schemaModel, label, errors, warnings) {
  const rule = getSchemaRule(schemaElementName, schemaModel);
  if (!rule) {
    return;
  }

  rule.requiredAttributes.forEach((attrName) => {
    if (!xmlElement.hasAttribute(attrName)) {
      warnings.push(createIssue(`${label}: XSD:n mukaan pakollinen attribuutti puuttuu: ${attrName}`, xmlElement, xmlText, { attributeName: attrName }));
    }
  });

  rule.requiredChildren.forEach((childName) => {
    if (!findFirstChildElement(xmlElement, childName)) {
      errors.push(createIssue(`${label}: XSD:n mukaan pakollinen alielementti puuttuu: ${childName}`, xmlElement, xmlText, { childName }));
    }
  });

  rule.requiredChoices.forEach((choiceNames) => {
    const found = choiceNames.some((name) => findFirstChildElement(xmlElement, name));
    if (!found) {
      errors.push(createIssue(`${label}: XSD:n mukaan vähintään yksi näistä alielementeistä vaaditaan: ${choiceNames.join(", ")}`, xmlElement, xmlText));
    }
  });
}

function createIssue(message, element = null, xmlText = "", options = {}) {
  const location = buildLocationInfo(element, xmlText, options);
  return {
    message,
    line: location.line,
    path: location.path,
    snippet: location.snippet
  };
}

function buildLocationInfo(element, xmlText, options = {}) {
  if (!element) {
    return {
      line: null,
      path: "",
      snippet: ""
    };
  }

  const path = buildElementPath(element);
  const line = estimateLineNumber(xmlText, element, path, options);
  const snippet = buildSnippet(element, options);

  return { line, path, snippet };
}

function buildElementPath(element) {
  const parts = [];
  let current = element;

  while (current && current.nodeType === 1) {
    const name = getLocalName(current);
    const siblings = current.parentElement
      ? Array.from(current.parentElement.children).filter((child) => getLocalName(child) === name)
      : [current];
    const index = siblings.indexOf(current) + 1;
    parts.unshift(`${name}[${index}]`);
    current = current.parentElement;
  }

  return "/" + parts.join("/");
}

function estimateLineNumber(xmlText, element, path, options = {}) {
  if (!xmlText || !element) {
    return null;
  }

  const tagName = getLocalName(element);
  const targetOccurrence = getPathOccurrenceIndex(path);
  const tagRegex = new RegExp(`<${escapeRegExp(tagName)}(?=[\\s>/])`, "g");

  let match;
  let occurrence = 0;

  while ((match = tagRegex.exec(xmlText)) !== null) {
    occurrence += 1;
    if (occurrence === targetOccurrence) {
      return xmlText.slice(0, match.index).split(/\r\n|\r|\n/).length;
    }
  }

  const fallbacks = [];
  if (options.childName) {
    fallbacks.push(`<${options.childName}`);
  }
  if (options.attributeName) {
    fallbacks.push(`${options.attributeName}=`);
  }
  fallbacks.push(`<${tagName}`);

  for (const candidate of fallbacks) {
    const idx = xmlText.indexOf(candidate);
    if (idx >= 0) {
      return xmlText.slice(0, idx).split(/\r\n|\r|\n/).length;
    }
  }

  return null;
}

function getPathOccurrenceIndex(path) {
  const match = path.match(/\[(\d+)\]$/);
  if (!match) {
    return 1;
  }
  return Number(match[1]) || 1;
}

function buildSnippet(element, options = {}) {
  const tagName = getLocalName(element);

  if (options.childName) {
    return `<${tagName}> ... <${options.childName}>`;
  }

  if (options.attributeName) {
    return `<${tagName} ${options.attributeName}="...">`;
  }

  return `<${tagName}>`;
}

function formatIssue(issue) {
  if (typeof issue === "string") {
    return issue;
  }

  const parts = [];

  if (issue.line) {
    parts.push(`rivi ${issue.line}`);
  }

  if (issue.path) {
    parts.push(issue.path);
  }

  let prefix = "";
  if (parts.length) {
    prefix = `[${parts.join(" | ")}] `;
  }

  if (issue.snippet) {
    return `${prefix}${issue.message}\n  kohta: ${issue.snippet}`;
  }

  return `${prefix}${issue.message}`;
}

function findDirectFeatureByCode(parent, code) {
  return findDirectChildren(parent, "Feature").find(
    (feature) => (feature.getAttribute("code") || "") === code
  ) || null;
}

function findDirectChildren(parent, localName) {
  return Array.from(parent.children).filter((child) => getLocalName(child) === localName);
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

function findFirstDeepChildElement(parent, localName) {
  return findElements(parent, localName)[0] || null;
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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function renderResult({ result, rootName, namespace, detectedTypeLabel, versionLabel, errors, warnings, infos }) {
  let summaryClass = "success";
  let summaryText = "✅ XML läpäisi tarkistuksen";

  if (errors.length > 0) {
    summaryClass = "error";
    summaryText = "❌ XML:ssä havaittiin virheitä";
  } else if (warnings.length > 0) {
    summaryClass = "warning";
    summaryText = "⚠️ XML tarkistettiin, mutta huomautuksia löytyi";
  }

  let html = `<span class="${summaryClass}">${summaryText}</span>\n\n`;
  html += `Root: ${escapeHtml(rootName)}\n`;
  html += `Namespace: ${escapeHtml(namespace || "ei määritelty")}\n`;
  html += `Versio: ${escapeHtml(versionLabel)}\n`;
  html += `Sisältötyyppi: ${escapeHtml(detectedTypeLabel)}\n`;

  if (infos.length) {
    html += `\n<b>Tiedot:</b>\n${escapeHtml(infos.join("\n"))}\n`;
  }

  if (errors.length) {
    html += `\n<b>Virheet:</b>\n${escapeHtml(errors.map(formatIssue).join("\n\n"))}\n`;
  }

  if (warnings.length) {
    html += `\n<b>Huomautukset:</b>\n${escapeHtml(warnings.map(formatIssue).join("\n\n"))}\n`;
  }

  if (!errors.length && !warnings.length) {
    html += `\nEi huomautuksia.\n`;
  }

  result.innerHTML = html;
}