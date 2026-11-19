import { useEffect, useState } from 'react';

/**
 * Blob から ObjectURL を生成し、アンマウント時または Blob 変更時に必ず revokeObjectURL() を呼ぶカスタムフック
 */
export function useObjectUrl(blob: Blob | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [blob]);

  return url;
}
