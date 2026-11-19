import { useEffect } from 'react';

/**
 * フォーカス中の要素がテキスト入力系要素かどうかを判定する
 */
function isTextInputElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  if (tagName === 'textarea') {
    return true;
  }

  if (tagName === 'input') {
    const input = target as HTMLInputElement;
    const nonTextTypes = new Set([
      'button',
      'checkbox',
      'color',
      'file',
      'hidden',
      'image',
      'radio',
      'range',
      'reset',
      'submit',
    ]);
    return !nonTextTypes.has((input.type || 'text').toLowerCase());
  }

  if (target.isContentEditable) {
    return true;
  }

  return Boolean(target.closest('[contenteditable="true"], [contenteditable=""]'));
}

/**
 * window全体のpasteイベントを監視し、クリップボード内の画像ファイルを抽出してコールバックに渡す
 */
export function useClipboardPaste(onImagesPasted: (files: File[]) => void, enabled: boolean = true) {
  useEffect(() => {
    if (!enabled) return;

    const handlePaste = (event: ClipboardEvent) => {
      // テキスト入力欄にフォーカスがある場合は通常のテキストペーストを優先
      if (isTextInputElement(event.target) || isTextInputElement(document.activeElement)) {
        return;
      }

      const clipboardData = event.clipboardData;
      if (!clipboardData) return;

      const imageFiles: File[] = [];

      if (clipboardData.items && clipboardData.items.length > 0) {
        for (let i = 0; i < clipboardData.items.length; i++) {
          const item = clipboardData.items[i];
          if (item.kind === 'file' && item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (file) {
              imageFiles.push(file);
            }
          }
        }
      } else if (clipboardData.files && clipboardData.files.length > 0) {
        for (let i = 0; i < clipboardData.files.length; i++) {
          const file = clipboardData.files[i];
          if (file.type.startsWith('image/')) {
            imageFiles.push(file);
          }
        }
      }

      if (imageFiles.length > 0) {
        event.preventDefault();
        onImagesPasted(imageFiles);
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => {
      window.removeEventListener('paste', handlePaste);
    };
  }, [onImagesPasted, enabled]);
}
