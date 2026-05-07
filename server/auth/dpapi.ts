import { dlopen, FFIType, ptr, toArrayBuffer, type Pointer } from "bun:ffi";

// Win32 DPAPI bindings. CryptProtectData / CryptUnprotectData encrypt/decrypt
// arbitrary blobs tied to the current Windows user account — the ciphertext is
// useless on any other machine or user account.
//
// MSDN signatures (BLOB pointers in/out, all other args nullable for our usage):
//   BOOL CryptProtectData(
//     DATA_BLOB *pDataIn, LPCWSTR szDataDescr, DATA_BLOB *pOptionalEntropy,
//     PVOID pvReserved, CRYPTPROTECT_PROMPTSTRUCT *pPromptStruct,
//     DWORD dwFlags, DATA_BLOB *pDataOut);
//   BOOL CryptUnprotectData(...identical shape...);
//
// DATA_BLOB layout on x64: { DWORD cbData; BYTE *pbData; } → 16 bytes
// (4-byte cbData + 4 bytes padding + 8-byte pointer).
const BLOB_SIZE = 16;

const crypt32 = dlopen("crypt32.dll", {
  CryptProtectData: {
    args: [
      FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr,
      FFIType.ptr, FFIType.u32, FFIType.ptr,
    ],
    returns: FFIType.bool,
  },
  CryptUnprotectData: {
    args: [
      FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr,
      FFIType.ptr, FFIType.u32, FFIType.ptr,
    ],
    returns: FFIType.bool,
  },
});

const kernel32 = dlopen("kernel32.dll", {
  // Output blob's pbData is allocated by Windows; we must LocalFree it after copy.
  LocalFree: { args: [FFIType.ptr], returns: FFIType.ptr },
  GetLastError: { args: [], returns: FFIType.u32 },
});

function makeBlob(data: Uint8Array): Buffer {
  const blob = Buffer.alloc(BLOB_SIZE);
  blob.writeUInt32LE(data.byteLength, 0);
  blob.writeBigUInt64LE(BigInt(ptr(data)), 8);
  return blob;
}

function readBlob(blob: Buffer): Uint8Array {
  const cbData = blob.readUInt32LE(0);
  const pbData = Number(blob.readBigUInt64LE(8)) as Pointer;
  // Copy out of foreign memory before LocalFree.
  return new Uint8Array(toArrayBuffer(pbData, 0, cbData).slice(0));
}

export function protect(plaintext: string): Buffer {
  const inputBytes = Buffer.from(plaintext, "utf8");
  const inBlob = makeBlob(inputBytes);
  const outBlob = Buffer.alloc(BLOB_SIZE);

  const ok = crypt32.symbols.CryptProtectData(
    ptr(inBlob), null, null, null, null, 0, ptr(outBlob),
  );
  if (!ok) {
    const err = kernel32.symbols.GetLastError();
    throw new Error(`CryptProtectData failed: Win32 error ${err}`);
  }

  const result = readBlob(outBlob);
  kernel32.symbols.LocalFree(Number(outBlob.readBigUInt64LE(8)) as Pointer);
  return Buffer.from(result);
}

export function unprotect(ciphertext: Buffer): string {
  const inBlob = makeBlob(ciphertext);
  const outBlob = Buffer.alloc(BLOB_SIZE);

  const ok = crypt32.symbols.CryptUnprotectData(
    ptr(inBlob), null, null, null, null, 0, ptr(outBlob),
  );
  if (!ok) {
    const err = kernel32.symbols.GetLastError();
    throw new Error(`CryptUnprotectData failed: Win32 error ${err}`);
  }

  const result = readBlob(outBlob);
  kernel32.symbols.LocalFree(Number(outBlob.readBigUInt64LE(8)) as Pointer);
  return Buffer.from(result).toString("utf8");
}
