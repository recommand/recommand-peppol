import { describe, expect, it } from 'bun:test';
import { mergeSupportedDocumentTypes } from '../data/at/supported-document-types';

describe('mergeSupportedDocumentTypes', () => {
  it('preserves capabilities that Arratech requires for an active participant', () => {
    expect(
      mergeSupportedDocumentTypes(
        [
          {
            documentId: 'at-mandatory',
            processId: 'urn:process:billing',
            exactMatchOnly: true,
          },
        ],
        [
          {
            documentId: 'at-configured',
            processId: 'urn:process:invoice-response',
          },
        ],
      ),
    ).toEqual([
      {
        documentId: 'at-mandatory',
        processId: 'urn:process:billing',
        exactMatchOnly: true,
      },
      {
        documentId: 'at-configured',
        processId: 'urn:process:invoice-response',
      },
    ]);
  });

  it('uses the requested settings for an existing capability', () => {
    expect(
      mergeSupportedDocumentTypes(
        [
          {
            documentId: 'at-invoice',
            processId: 'urn:process:billing',
            exactMatchOnly: true,
          },
        ],
        [
          {
            documentId: 'at-invoice',
            processId: 'urn:process:billing',
            exactMatchOnly: false,
          },
        ],
      ),
    ).toEqual([
      {
        documentId: 'at-invoice',
        processId: 'urn:process:billing',
        exactMatchOnly: false,
      },
    ]);
  });
});
