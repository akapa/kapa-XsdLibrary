define(['objTools', 'Library', 'xsd', 'text!basetypes.xsd'],
function (objTools, Library, xsd, basetypesXsd) {

	/**
	 * A basic library/collection used to store and retrieve items.
	 * @external Library
	 */
	var xsdLibrary = objTools.make(Library, 
	/**
	 * @lends XsdLibrary.prototype
	 */
	{
		/**
		 * @constructor XsdLibrary
		 * @classdesc Stores XSD Documents and can do lookups in them.
		 * @param {Document[]} defs - An array of XSD (XML) Document objects to store initially.
		 * @extends external:Library
		 */
		init: function (defs) {
			defs = defs || [];
			var initDefs = [xsd.parseToDom(basetypesXsd)].concat(defs);
			return new Library().init.call(this, initDefs);
		},
		/**
		 * Adds an XSD Document to the library.
		 * @param {Document} def - An XSD (XML) Document object.
		 * @param {string} [name] - The namespace the XSD should be used to validate - read from the XSD's targetnamespace if not given.
		 */	
		addItem: function (def, name) {
			var ns = name || def.documentElement.getAttributeNS(null, 'targetNamespace');
			var xsdCollection = this.exists(ns)	? this.getItem(ns) : [];
			xsdCollection.push(def);
			this.items[ns] = xsdCollection;
		},
		/**
		 * Finds an XSD root &lt;element&gt; in the library.
		 * @param {string} namespace - The target namespace of the element (an XSD document will be chosen based on this).
		 * @param {string} name - The node name of the element to be found.
		 * @returns {Element|null}
		 */	
		findElement: function (namespace, name) {
			var xsds = this.getItem(namespace) || [];
			var element;
			for (var i = 0, l = xsds.length; i < l; i++) {
				element = xsd.findElement(xsds[i], name);
				if (element) {
					return element;
				}
			}
			return null;
		},
		/**
		 * Finds an XSD type definition (complexType or simpleType) in the library.
		 * @param {string} namespace - The namespace of the type definition (an XSD document will be chosen based on this).
		 * @param {string} name - The name of the type to be found.
		 * @returns {Element|null}
		 */
		findTypeByName: function (namespace, name) {
			var xsds = this.getItem(namespace) || [];
			var xsdNodes;
			for (var i = 0, l = xsds.length; i < l; i++) {
				xsdNode = xsd.findTypeByName(xsds[i], name);
				if (xsdNode) {
					return xsdNode;
				}
			}
			return null;
		},
		/**
		 * Finds the type definition based on the type read from specified attribute of the given element.
		 * @param {Element} node - The element to read the attribute from.
		 * @param {string} typeAttr - The name of the attribute that holds the type.
		 * @param {string} [typeAttrNS] - The namespace of the attribute (if any) that holds the type.
		 * @returns {Element|null}
		 */
		findTypeDefinitionFromNodeAttr: function (node, typeAttr, typeAttrNS) {
			var type = xsd.getTypeFromNodeAttr(node, typeAttr, typeAttrNS);
			return type ? this.findTypeByName(type.namespaceURI, type.name) : null;
		},
		findElementForXmlNode: function (node) {
			var parents = [];
			xsd.getFirstFilteredAncestor(node, function (current) {
				parents.push(current);
				return xsd.getTypeFromNodeAttr(current, 'type', xsd.xsi);
			});

			var xsdNode;
			_(parents.reverse()).each(function (currParent) {
				xsdNode = xsdNode ?
					this.findXsdSubNode(xsdNode, currParent.localName) :
					this.findTypeDefinitionFromNodeAttr(currParent, 'type', xsd.xsi);
			}, this);

			return this.findXsdSubNode(xsdNode, node.localName);
		},
		findElementType: function (elem) {
			var tdef = xsd.getTypeFromNodeAttr(elem, 'type');
			return xsd.getEmbeddedType(elem) || 
				this.findTypeByName(tdef.namespaceURI, tdef.name);
		},
		findXsdSubNode: function (xsdNode, name) {
			if (xsdNode.localName === 'element') {
				xsdNode = this.findTypeDefinitionFromNodeAttr(xsdNode, 'type') || xsdNode.children[0];
			}
			return xsd.findElement(xsdNode, name);
		},
		findRestrictedType: function (node) {
			var	element = _(node.children).find(function (child) {
				return child.namespaceURI === xsd.xs && 
					child.localName === 'restriction';
			});
			console.log(element);
			return element ? this.findTypeDefinitionFromNodeAttr(element, 'base') : null;
		},
		findExtendedType: function (node) {
			if (node.localName === 'complexType') {
				node = xsd.getComplexTypeContent(node);
			}
			var element = _(node.children).find(function (child) {
					return child.namespaceURI === xsd.xs && child.localName === 'extension';
				});
			return element ? this.findTypeDefinitionFromNodeAttr(element, 'base') : null;
		},
		/**
		 * Finds the base type for a simpleType definition. Follows inheritance until it reaches a base XSD type.
		 * @param {Element} node - The type definition node to start from.
		 * @returns {string} The name of the base type (like: string, decimal, dateTime, etc.).
		 */
		findBaseTypeFor: function (node) {
			var curr, base;
			do {
				curr = base ? base : node;
				base = this.findRestrictedType(curr);
			} while (base);
			return curr.getAttribute('name');
		},
		collectFacets: function (simpleType) {
			var facets = [];
			var currType = simpleType;
			var currFacets, enums;
			var foundFacetTypes = [];
			var processFacet = function (facet) {
				var fname = facet.localName;
				var isEnum = fname === 'enumeration';
				var isAssertion = fname === 'assertion';
				var isAlreadyFound = foundFacetTypes.indexOf(fname) !== -1;
				var isFixed = !isEnum && 
					(isAssertion || facet.getAttribute('fixed') === 'true');

				if (!isAlreadyFound || isFixed) {
					(isEnum ? enums : facets).push(facet);
					if (!isEnum) {
						foundFacetTypes.push(fname);
					}
				}
			};

			while (currType) {
				currFacets = xsd.findRestrictingFacets(currType);
				enums = [];
				_(currFacets).each(processFacet);
				if (enums.length) {
					facets.push(enums);
					foundFacetTypes.push('enumeration');
				}
				currType = this.findRestrictedType(currType);
			}
			return facets;
		},
		getComplexTypeElements: function (complexType) {
			var elems = [];
			var curr = complexType;
			while (curr) {
				elems = elems.concat(xsd.getComplexTypeElements(curr));
				curr = this.findExtendedType(curr);
			}
			return elems;
		},
		getComplexTypeAsserts: function (complexType) {
			var elems = [];
			var curr = complexType;
			while (curr) {
				elems = elems.concat(xsd.getComplexTypeAsserts(curr));
				curr = this.findExtendedType(curr);
			}
			return elems;
		}
	});

	return objTools.makeConstructor(function XsdLibrary () {}, xsdLibrary);
});