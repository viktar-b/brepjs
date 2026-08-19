# Declarative infrastructure bridge

This private example authors bridge Families and Assemblies with typed props, engineering semantics, stable occurrence keys, and nested rigid Frames. Ordinary build, preview, tests, and IFC export are independent of the reference IFC.

```sh
npm -C examples/infra-bridge run check
npm -C examples/infra-bridge run preview
npm -C examples/infra-bridge run export:ifc
```

The separate Reference Harness comparison is the only command that accepts reference bytes:

```sh
npm -C examples/infra-bridge run reference:compare -- --ifc tmp/Infra-Bridge.ifc
```

Generated artifacts are written under `examples/infra-bridge/dist/`.
