"use client";

import Image, { type ImageProps } from "next/image";
import { useState } from "react";

/**
 * next/image with a duotone fallback.
 *
 * Every usage is `fill` inside a `relative` parent, so we paint a warm block
 * underneath the photo. If the photo fails to load — offline, a blocked host,
 * a dead URL — the block stays and the section still reads as designed, rather
 * than collapsing to a broken-image icon and alt text.
 */
export default function Photo(props: ImageProps) {
  const [failed, setFailed] = useState(false);

  return (
    <>
      <div aria-hidden className="absolute inset-0 bg-umber-800" />
      {!failed && <Image {...props} onError={() => setFailed(true)} />}
    </>
  );
}
