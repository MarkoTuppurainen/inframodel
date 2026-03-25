window.validateXML = validateXML;

const EXPECTED_NAMESPACES = {
  default: "http://buildingsmart.fi/inframodel/404",
  im: "http://buildingsmart.fi/im/404"
};

const XSD_TEMPLATE_VALUES = {
  release_directory: "http://buildingsmart.fi/inframodel/404",
  github_release: "4.2.0"
};

const XSD_SOURCES = [
  {
    name: "inframodel-raw.xsd",
    url: "https://raw.githubusercontent.com/buildingSMART-Finland/InfraModel/4.2.0/schema/inframodel-raw.xsd"
  },
  {
    name: "im-raw.xsd",
    url: "https://raw.githubusercontent.com/buildingSMART-Finland/InfraModel/4.2.0/schema/im-raw.xsd"
  }
];

let schemaModelCache = null;

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

  let schemaModel = null;

  try {
    schemaModel = await loadSchemaModel();
    infos.push("XSD-säännöt ladattu");
  } catch (error) {
    warnings.push(`XSD-sääntöjen lataus epäonnistui: ${String(error)}`);
  }

  validateGeneralStructure(xmlDoc, errors, warnings, infos);

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

  const defaultNs = root.namespaceURI || "";
  const imNs = root.getAttribute("xmlns:im") || "";

  if (!defaultNs) {
    errors.push("Namespace puuttuu juurielementiltä");
  } else if (defaultNs !== EXPECTED_NAMESPACES.default) {
    errors.push(
      `Oletusnamespace ei ole InfraModelin mukainen (nyt: ${defaultNs}, odotettu: ${EXPECTED_NAMESPACES.default})`
    );
  }

  if (imNs && imNs !== EXPECTED_NAMESPACES.im) {
    warnings.push(
      `im-namespace poikkeaa odotetusta (nyt: ${imNs}, odotettu: ${EXPECTED_NAMESPACES.im})`
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

  const requiredRootAttributes = ["date", "time", "version", "language", "readOnly"];
  requiredRootAttributes.forEach((attrName) => {
    if (!root.hasAttribute(attrName)) {
      warnings.push(`Juurielementiltä puuttuu suositeltu attribuutti: ${attrName}`);
    }
  });

  const project = findFirstElement(xmlDoc, "Project");
  if (!project) {
    warnings.push("Project-elementtiä ei löytynyt");
  } else {
    if (!project.getAttribute("name")) {
      warnings.push("Project-elementiltä puuttuu name-attribuutti");
    }
    if (!project.getAttribute("desc")) {
      warnings.push("Project-elementiltä puuttuu desc-attribuutti");
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
    case "unknown":
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
    validateElementWithSchemaRule(
      alignmentsContainer,
      "Alignments",
      schemaModel,
      "Alignments",
      errors,
      warnings
    );
  }

  if (alignmentList.length === 0) {
    errors.push("Tiedosto näyttää linjausaineistolta, mutta Alignment-elementtejä ei löytynyt");
    return;
  }

  alignmentList.forEach((alignment, index) => {
    const number = index + 1;

    if (schemaModel) {
      validateElementWithSchemaRule(
        alignment,
        "Alignment",
        schemaModel,
        `Alignment #${number}`,
        errors,
        warnings
      );
    }

    if (!alignment.getAttribute("name")) {
      warnings.push(`Alignment #${number}: name-attribuutti puuttuu`);
    }

    if (!alignment.getAttribute("length")) {
      warnings.push(`Alignment #${number}: length-attribuutti puuttuu`);
    }

    const coordGeom = findFirstChildElement(alignment, "CoordGeom");
    if (!coordGeom) {
      errors.push(`Alignment #${number}: pakollinen CoordGeom-elementti puuttuu`);
      return;
    }

    if (schemaModel) {
      validateElementWithSchemaRule(
        coordGeom,
        "CoordGeom",
        schemaModel,
        `Alignment #${number} CoordGeom`,
        errors,
        warnings
      );
    }

    const lines = findChildElementsDeep(coordGeom, "Line");
    const curves = findChildElementsDeep(coordGeom, "Curve");
    const spirals = findChildElementsDeep(coordGeom, "Spiral");
    const totalGeom = lines.length + curves.length + spirals.length;

    if (totalGeom === 0) {
      errors.push(`Alignment #${number}: CoordGeom ei sisällä geometriaelementtejä (Line/Curve/Spiral)`);
    }

    lines.forEach((line, lineIndex) => {
      if (schemaModel) {
        validateElementWithSchemaRule(
          line,
          "Line",
          schemaModel,
          `Alignment #${number}, Line #${lineIndex + 1}`,
          errors,
          warnings
        );
      }

      validateStartEndPoints(
        line,
        `Alignment #${number}, Line #${lineIndex + 1}`,
        errors,
        warnings
      );

      if (!line.getAttribute("length")) {
        warnings.push(`Alignment #${number}, Line #${lineIndex + 1}: length-attribuutti puuttuu`);
      }
    });

    curves.forEach((curve, curveIndex) => {
      if (schemaModel) {
        validateElementWithSchemaRule(
          curve,
          "Curve",
          schemaModel,
          `Alignment #${number}, Curve #${curveIndex + 1}`,
          errors,
          warnings
        );
      }

      validateStartEndPoints(
        curve,
        `Alignment #${number}, Curve #${curveIndex + 1}`,
        errors,
        warnings
      );

      if (!curve.getAttribute("radius")) {
        warnings.push(`Alignment #${number}, Curve #${curveIndex + 1}: radius-attribuutti puuttuu`);
      }
    });

    spirals.forEach((spiral, spiralIndex) => {
      if (schemaModel) {
        validateElementWithSchemaRule(
          spiral,
          "Spiral",
          schemaModel,
          `Alignment #${number}, Spiral #${spiralIndex + 1}`,
          errors,
          warnings
        );
      }

      validateStartEndPoints(
        spiral,
        `Alignment #${number}, Spiral #${spiralIndex + 1}`,
        errors,
        warnings
      );
    });
  });
}

function validateSurfaceContent(xmlDoc, schemaModel, errors, warnings) {
  const surfacesContainer = findFirstElement(xmlDoc, "Surfaces");
  const surfaces = findElements(xmlDoc, "Surface");

  if (!surfacesContainer && surfaces.length > 0) {
    warnings.push("Surface-elementtejä löytyi, mutta niitä kokoavaa Surfaces-elementtiä ei löytynyt");
  }

  if (surfacesContainer && schemaModel) {
    validateElementWithSchemaRule(
      surfacesContainer,
      "Surfaces",
      schemaModel,
      "Surfaces",
      errors,
      warnings
    );
  }

  if (surfaces.length === 0) {
    errors.push("Tiedosto näyttää pintamallilta, mutta Surface-elementtejä ei löytynyt");
    return;
  }

  surfaces.forEach((surface, index) => {
    const number = index + 1;

    if (schemaModel) {
      validateElementWithSchemaRule(
        surface,
        "Surface",
        schemaModel,
        `Surface #${number}`,
        errors,
        warnings
      );
    }

    if (!surface.getAttribute("name")) {
      warnings.push(`Surface #${number}: name-attribuutti puuttuu`);
    }

    const definition = findFirstChildElement(surface, "Definition");
    if (!definition) {
      errors.push(`Surface #${number}: pakollinen Definition-elementti puuttuu`);
      return;
    }

    if (schemaModel) {
      validateElementWithSchemaRule(
        definition,
        "Definition",
        schemaModel,
        `Surface #${number} Definition`,
        errors,
        warnings
      );
    }

    const pntsNode = findFirstChildElement(definition, "Pnts");
    const facesNode = findFirstChildElement(definition, "Faces");

    const pointNodes = pntsNode ? findChildElementsDeep(pntsNode, "P") : [];
    const faceNodes = facesNode ? findChildElementsDeep(facesNode, "F") : [];

    if (!pntsNode) {
      errors.push(`Surface #${number}: Definition-elementin alta puuttuu Pnts`);
    } else if (schemaModel) {
      validateElementWithSchemaRule(
        pntsNode,
        "Pnts",
        schemaModel,
        `Surface #${number} Pnts`,
        errors,
        warnings
      );
    }

    if (!facesNode) {
      errors.push(`Surface #${number}: Definition-elementin alta puuttuu Faces`);
    } else if (schemaModel) {
      validateElementWithSchemaRule(
        facesNode,
        "Faces",
        schemaModel,
        `Surface #${number} Faces`,
        errors,
        warnings
      );
    }

    if (pointNodes.length === 0) {
      errors.push(`Surface #${number}: Pnts-elementti ei sisällä yhtään P-pistettä`);
    }

    if (faceNodes.length === 0) {
      errors.push(`Surface #${number}: Faces-elementti ei sisällä yhtään F-kolmiota`);
    }

    pointNodes.forEach((point, pointIndex) => {
      const text = normalizeWhitespace(point.textContent);
      if (!text) {
        errors.push(`Surface #${number}, P #${pointIndex + 1}: pisteen koordinaattisisältö puuttuu`);
      }
    });

    faceNodes.forEach((face, faceIndex) => {
      const text = normalizeWhitespace(face.textContent);
      if (!text) {
        errors.push(`Surface #${number}, F #${faceIndex + 1}: kolmion indeksisisältö puuttuu`);
      }
    });
  });
}

function validatePipeContent(xmlDoc, schemaModel, errors, warnings) {
  const networksContainer = findFirstElement(xmlDoc, "PipeNetworks");
  const networks = findElements(xmlDoc, "PipeNetwork");

  if (!networksContainer && networks.length > 0) {
    warnings.push("PipeNetwork-elementtejä löytyi, mutta niitä kokoavaa PipeNetworks-elementtiä ei löytynyt");
  }

  if (networksContainer && schemaModel) {
    validateElementWithSchemaRule(
      networksContainer,
      "PipeNetworks",
      schemaModel,
      "PipeNetworks",
      errors,
      warnings
    );
  }

  if (networks.length === 0) {
    errors.push("Tiedosto näyttää verkostoaineistolta, mutta PipeNetwork-elementtejä ei löytynyt");
    return;
  }

  networks.forEach((network, index) => {
    const number = index + 1;

    if (schemaModel) {
      validateElementWithSchemaRule(
        network,
        "PipeNetwork",
        schemaModel,
        `PipeNetwork #${number}`,
        errors,
        warnings
      );
    }

    if (!network.getAttribute("name")) {
      warnings.push(`PipeNetwork #${number}: name-attribuutti puuttuu`);
    }

    const pipes = findChildElementsDeep(network, "Pipe");
    const structures = findChildElementsDeep(network, "Struct");
    const fittings = findChildElementsDeep(network, "Fitting");
    const appurtenances = findChildElementsDeep(network, "Appurtenance");

    const totalNetworkObjects =
      pipes.length + structures.length + fittings.length + appurtenances.length;

    if (totalNetworkObjects === 0) {
      errors.push(`PipeNetwork #${number}: verkoston sisältö puuttuu (Pipe/Struct/Fitting/Appurtenance)`);
    }

    pipes.forEach((pipe, pipeIndex) => {
      if (!pipe.getAttribute("name")) {
        warnings.push(`PipeNetwork #${number}, Pipe #${pipeIndex + 1}: name-attribuutti puuttuu`);
      }
    });
  });
}

function validatePointContent(xmlDoc, schemaModel, errors, warnings) {
  const cgPointsContainer = findFirstElement(xmlDoc, "CgPoints");
  const cgPoints = findElements(xmlDoc, "CgPoint");

  if (!cgPointsContainer && cgPoints.length > 0) {
    warnings.push("CgPoint-elementtejä löytyi, mutta niitä kokoavaa CgPoints-elementtiä ei löytynyt");
  }

  if (cgPointsContainer && schemaModel) {
    validateElementWithSchemaRule(
      cgPointsContainer,
      "CgPoints",
      schemaModel,
      "CgPoints",
      errors,
      warnings
    );
  }

  if (cgPoints.length === 0) {
    errors.push("Tiedosto näyttää pisteaineistolta, mutta CgPoint-elementtejä ei löytynyt");
    return;
  }

  cgPoints.forEach((point, index) => {
    const number = index + 1;

    if (schemaModel) {
      validateElementWithSchemaRule(
        point,
        "CgPoint",
        schemaModel,
        `CgPoint #${number}`,
        errors,
        warnings
      );
    }

    const text = normalizeWhitespace(point.textContent);

    if (!text) {
      errors.push(`CgPoint #${number}: pakollinen koordinaattisisältö puuttuu`);
    }

    const parts = text.split(/\s+/).filter(Boolean);
    if (parts.length < 2) {
      errors.push(`CgPoint #${number}: koordinaatteja on liian vähän`);
    }
  });
}

function validateGenericLandXMLContent(xmlDoc, schemaModel, errors, warnings) {
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

  if (schemaModel) {
    validateElementWithSchemaRule(root, "LandXML", schemaModel, "LandXML", errors, warnings);
  }
}

async function loadSchemaModel() {
  if (schemaModelCache) {
    return schemaModelCache;
  }

  const docs = await Promise.all(
    XSD_SOURCES.map(async (source) => {
      const response = await fetch(source.url, { cache: "force-cache" });
      if (!response.ok) {
        throw new Error(`XSD-tiedoston lataus epäonnistui: ${source.name} (${response.status})`);
      }

      const originalText = await response.text();
      const text = preprocessXsdText(originalText, source.name);

      const doc = new DOMParser().parseFromString(text, "application/xml");
      const parseError = doc.querySelector("parsererror");

      if (parseError) {
        throw new Error(`XSD-tiedosto ei ole kelvollinen XML esikäsittelyn jälkeen: ${source.name}`);
      }

      return doc;
    })
  );

  schemaModelCache = buildSchemaModel(docs);
  return schemaModelCache;
}

function preprocessXsdText(text, sourceName) {
  let processed = text;

  processed = processed.replaceAll("{{release_directory}}/im", EXPECTED_NAMESPACES.im);
  processed = processed.replaceAll("{{release_directory}}", EXPECTED_NAMESPACES.default);
  processed = processed.replaceAll("{{github_release}}", XSD_TEMPLATE_VALUES.github_release);

  if (sourceName === "im-raw.xsd") {
    processed = processed.replaceAll(`targetNamespace="${EXPECTED_NAMESPACES.default}/im"`, `targetNamespace="${EXPECTED_NAMESPACES.im}"`);
    processed = processed.replaceAll(`xmlns:im="${EXPECTED_NAMESPACES.default}/im"`, `xmlns:im="${EXPECTED_NAMESPACES.im}"`);
  }

  return processed;
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

      if (parentLocalName === "schema" && localName === "element" && node.getAttribute("name")) {
        model.globalElements.set(node.getAttribute("name"), node);
      }

      if (parentLocalName === "schema" && localName === "complexType" && node.getAttribute("name")) {
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
      if (child.getAttribute("use") === "required" && child.getAttribute("name")) {
        rule.requiredAttributes.push(child.getAttribute("name"));
      }
      return;
    }

    if (childName === "sequence" || childName === "all") {
      parseModelGroup(child, schemaModel, rule, visitedTypeNames, false);
      return;
    }

    if (childName === "choice") {
      parseModelGroup(child, schemaModel, rule, visitedTypeNames, true);
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
            if (extChild.getAttribute("use") === "required" && extChild.getAttribute("name")) {
              rule.requiredAttributes.push(extChild.getAttribute("name"));
            }
          }

          if (extName === "sequence" || extName === "all") {
            parseModelGroup(extChild, schemaModel, rule, visitedTypeNames, false);
          }

          if (extName === "choice") {
            parseModelGroup(extChild, schemaModel, rule, visitedTypeNames, true);
          }
        });
      }
    }
  });

  return normalizeRule(rule);
}

function parseModelGroup(groupNode, schemaModel, rule, visitedTypeNames, treatAsChoice) {
  const requiredChoice = [];

  Array.from(groupNode.children).forEach((child) => {
    const childName = getLocalName(child);

    if (childName === "element") {
      const minOccurs = parseOccurs(child.getAttribute("minOccurs"), 1);
      const isRequired = minOccurs > 0;
      const targetName = child.getAttribute("name") || localTypeName(child.getAttribute("ref"));

      if (!targetName) {
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
      parseModelGroup(child, schemaModel, rule, visitedTypeNames, false);
      return;
    }

    if (childName === "choice") {
      parseModelGroup(child, schemaModel, rule, visitedTypeNames, true);
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

function validateStartEndPoints(element, label, errors, warnings) {
  const start = findFirstChildElement(element, "Start");
  const end = findFirstChildElement(element, "End");

  if (!start) {
    errors.push(`${label}: Start-elementti puuttuu`);
  } else if (!normalizeWhitespace(start.textContent)) {
    errors.push(`${label}: Start-elementin koordinaattisisältö puuttuu`);
  }

  if (!end) {
    errors.push(`${label}: End-elementti puuttuu`);
  } else if (!normalizeWhitespace(end.textContent)) {
    errors.push(`${label}: End-elementin koordinaattisisältö puuttuu`);
  }

  if (!element.getAttribute("staStart")) {
    warnings.push(`${label}: staStart-attribuutti puuttuu`);
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