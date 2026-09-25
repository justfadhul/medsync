/**
 * What proof a facility's ownership asks for (§5.7, DOC-2). Government: the registry listing, no
 * document. PNFP: bureau accreditation or licence (number + document). Private: the issuing
 * council, a number and the licence. Nothing until the ownership is known.
 */
export type Proof = "registry" | "bureau" | "licence";

export const proofFor = (ownership: string | undefined): Proof | null =>
  !ownership
    ? null
    : ownership === "public_moh"
      ? "registry"
      : ownership === "pnfp"
        ? "bureau"
        : "licence";
