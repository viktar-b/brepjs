# Declarative CAD/BIM Authoring

brepjs models physical works as readable, reusable source while keeping reference artifacts outside the authored model.

## Language

**Family**:
A reusable parametric definition of an engineering object, owned as source and independent of any particular placement.
_Avoid_: IFC entity, template, donor component

**Family Catalog**:
A curated set of reusable Families and Assemblies that accelerates common authoring without defining the boundary of what the system can model.
_Avoid_: exhaustive component list, supported IFC entities

**Scaffold Template**:
A versioned project-generation recipe that creates an initial copy-owned repository structure and starter source. It is tooling for beginning a project, not a reusable physical definition or a runtime dependency.
_Avoid_: Family, BIM Capability Profile, managed project

**BIM Capability Profile**:
A measurable authoring and interoperability contract for a built-asset domain or use case, including its required semantics, representations, relationships, and Fidelity Gates.
_Avoid_: full IFC support, entity checklist

**Occurrence**:
A keyed placement of a family within a model or assembly. Occurrences may share geometry while retaining distinct identity.
_Avoid_: instance index, copied component

**Assembly**:
A reusable composition of keyed occurrences whose positions are expressed relative to the assembly.
_Avoid_: group, container

**Spatial Assembly**:
An Assembly whose keyed Occurrence establishes an authored spatial boundary and parent frame within a Model. Sites, Facilities, and Spatial Parts are Spatial Assemblies; Projection maps them to target-specific spatial entities and relationships.
_Avoid_: IFC entity tree, filesystem hierarchy, transform container

**Facility**:
A principal built-asset Occurrence beneath a Site, such as a building or bridge, that owns its spatial breakdown through Spatial Parts.
_Avoid_: IfcFacility instance, generic container, whole project

**Spatial Part**:
A keyed spatial Occurrence that subdivides a Facility, such as a building storey or bridge part, and contains lower Spatial Parts or physical-product Occurrences.
_Avoid_: IfcFacilityPart instance, arbitrary group, folder

**Spatial Composition**:
The authored decomposition meaning of a Spatial Assembly Occurrence: a collection of subordinate spatial Occurrences, an independently usable element, or a partial subdivision of another spatial Occurrence.
_Avoid_: IFC composition enum, nesting depth, folder structure

**Model**:
The root authored composition of assemblies and occurrences that represents the intended physical work.
_Avoid_: source IFC, inventory

**Site**:
A spatial Occurrence within a Model that establishes the civil context and parent frame for facilities and other physical works.
_Avoid_: positioning wrapper, transform container

**Set-out**:
An authored civil placement instruction that locates an Occurrence relative to its parent using engineering controls such as an origin, bearing, and elevation.
_Avoid_: Datum, world transform, baked coordinates

**Reference IFC**:
An external artifact used to calibrate and verify an authored model. It is never a runtime dependency or a source of production identity.
_Avoid_: donor IFC, source model

**Semantic Key**:
A human-meaningful, order-independent name that identifies an occurrence within its parent and seeds durable downstream identity.
_Avoid_: Express ID, array index, imported GlobalId

**Local Frame**:
A rigid placement expressed relative to an occurrence's parent. Families define geometry around their own meaningful datum rather than final world coordinates.
_Avoid_: world transform, baked placement

**Projection**:
The translation of an authored model into a target representation such as meshes or IFC. Projection owns target-specific classes, relationships, identity encoding, and serialization.
_Avoid_: family export logic, component writer

**Authored Dimension**:
An intentional engineering measurement expressed as a named family or assembly parameter, including one calibrated from a reference artifact.
_Avoid_: mesh bound, extracted coordinate

**Reference Harness**:
An external verifier that compares an authored model with a Reference IFC without becoming a dependency of that model.
_Avoid_: reconstruction runtime, donor adapter

**Engineering Semantics**:
Target-independent meaning attached to an authored object, including its structural kind, domain category, engineering role, material, and intentional properties. Projection translates this meaning into target-specific entities.
_Avoid_: IFC class string, export metadata

**Datum**:
The documented engineering origin and axis convention around which a Family defines its geometry.
_Avoid_: Set-out, occurrence placement, mesh origin, imported placement

**Owned Asset**:
A source-controlled project artifact intentionally used by an authored component when a shape cannot reasonably be expressed parametrically. It is not extracted from a Reference IFC.
_Avoid_: fallback mesh, copied tessellation

**Product Body**:
The projection-ready geometric representation of an authored engineering object. Projection may preserve an analytic form or derive tessellation from the authored geometry without changing the object's semantics.
_Avoid_: proxy geometry, reference mesh

**Resolved Model**:
The immutable authored tree after component evaluation and Local Frame composition. It preserves every Model, Assembly, and Family boundary together with key paths, local and world frames, Engineering Semantics, and geometry.
_Avoid_: flattened scene, render result

**Reference Manifest**:
A Reference Harness document that pairs Semantic Keys with identities in one checksummed Reference IFC. It is never imported by the authored Model.
_Avoid_: model inventory, source identity map

**Fidelity Gate**:
An independently reported acceptance check for authored structure, geometry, placement, semantics, relationships, materials, identity stability, or visual similarity.
_Avoid_: composite score, overall percentage

**Representation Decoder**:
A Reference Harness adapter that interprets a complete source representation item and preserves the strongest available evidence, including topology, placements, units, and optional analytic geometry.
_Avoid_: point-list importer, universal mesh loader

**Reconstruction Target**:
A component-local reference observation containing a comparison surface plus any available analytic topology, semantics, dimensions, and placement evidence. It is input to reconstruction but never to the authored Model at runtime.
_Avoid_: donor geometry, component data

**Candidate Family**:
A proposed owned definition produced by reconstruction. It becomes a Family only after its dimensions, Datum, operations, semantics, cleanliness, and Fidelity Gates pass authoring review.
_Avoid_: generated final component, fitted mesh wrapper
