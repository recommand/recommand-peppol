function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer;
}

export async function generateFacturXDocument(options: {
  xmlDocument: string;
  pdf: {
    filename: string;
    mimeCode?: string | null;
    content: Buffer;
  };
}): Promise<Buffer> {
  const formData = new FormData();
  formData.append(
    "pdf",
    new File([toArrayBuffer(options.pdf.content)], options.pdf.filename, {
      type: options.pdf.mimeCode || "application/pdf",
    })
  );
  formData.append(
    "xml",
    new File([options.xmlDocument], "factur-x.xml", {
      type: "application/xml",
    })
  );

  const response = await fetch("https://facturx.recommand.dev/generate_facturx", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    let errorText = "";
    try{
      const errorJson = await response.json();
      errorText = errorJson.error;
    } catch (error) {
      errorText = await response.text();
    }
    throw new Error(`Failed to generate Factur-X document. ${errorText}`);
  }

  return Buffer.from(await response.arrayBuffer());
}
