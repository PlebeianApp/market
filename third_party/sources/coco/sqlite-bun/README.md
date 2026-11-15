# SQLite-Bun declaration metadata

`index.d.ts` is the exact declaration shipped in
`cashu-coco-sqlite-bun-2.0.0-plebeian-r1.tgz`, SHA-256
`674f2e4bdc73cd0e427703cc60e0c3ea7e9e7f664a10c738d99e09ccd7e00f5c`.

The retained build history does not contain a generator for these exact bytes.
This repository therefore treats the file explicitly as reviewed,
hand-maintained API metadata rather than generated output. The runtime
JavaScript remains byte-for-byte reproducible from the pinned Coco source.

`cashu-wrapper/ts/coco-sqlite-bun-declaration-conformance.test.ts` binds this
declaration to the installed package at compile time and checks the public
constructor, repository properties and methods at runtime. A future generated
declaration must use a new package identity/hash and repeat downstream tests;
do not silently replace the declaration inside the existing archive.
