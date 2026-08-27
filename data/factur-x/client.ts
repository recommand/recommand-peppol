function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer;
}

async function getErrorText(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) {
    return response.statusText;
  }

  try {
    const errorJson = JSON.parse(text);
    return errorJson.error ?? text;
  } catch (error) {
    return text;
  }
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
    const errorText = await getErrorText(response);
    throw new Error(`Failed to generate Factur-X document. ${errorText}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

export async function extractFacturXDocument(options: {
  pdf: {
    filename?: string;
    mimeCode?: string | null;
    content: Buffer;
  };
  checkXsd?: boolean;
  checkSchematron?: boolean;
  filename?: string;
}): Promise<{ xmlDocument: string }> {
  const formData = new FormData();
  formData.append(
    "pdf",
    new File(
      [toArrayBuffer(options.pdf.content)],
      options.pdf.filename ?? "factur-x.pdf",
      {
        type: options.pdf.mimeCode || "application/pdf",
      }
    )
  );
  if (options.checkXsd !== undefined) {
    formData.append("check_xsd", options.checkXsd ? "true" : "false");
  }
  if (options.checkSchematron !== undefined) {
    formData.append(
      "check_schematron",
      options.checkSchematron ? "true" : "false"
    );
  }
  if (options.filename) {
    formData.append("filename", options.filename);
  }

  const response = await fetch("https://facturx.recommand.dev/extract_facturx", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const errorText = await getErrorText(response);
    throw new Error(`Failed to extract Factur-X document. ${errorText}`);
  }

  const xmlDocument = await response.text();
  if (!xmlDocument.trim()) {
    throw new Error("Factur-X extraction response was empty.");
  }
  return { xmlDocument };
}
