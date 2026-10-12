import { AppException } from '../common/app-error';
import { LocalFolderScanner } from './local-folder.scanner';

describe('LocalFolderScanner', () => {
  it('throws a structured error for a missing source folder', () => {
    const scanner = new LocalFolderScanner();

    expect(() => scanner.scan('Z:/definitely/missing/context-forge-source')).toThrow(AppException);
    try {
      scanner.scan('Z:/definitely/missing/context-forge-source');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'source_folder_missing',
        stage: 'scan_source',
      });
    }
  });
});
