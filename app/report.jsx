'use client';
import { Button } from './ui/button';
import { useEffect, useRef, useState } from 'react';

export function ReportActions({ text, en, filename }) {
  const [state, setState] = useState('');
  const fallbackRef = useRef(null);

  useEffect(() => {
    setState('');
  }, [text]);

  useEffect(() => {
    if (state === 'select') {
      fallbackRef.current?.focus();
      fallbackRef.current?.select();
    }
  }, [state]);

  async function copy() {
    try {
      if (!navigator?.clipboard?.writeText) {
        throw new Error('Clipboard unavailable');
      }
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('select');
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `LatihKerja-${en ? 'example' : 'contoh'}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setState('downloaded');
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const statusText =
    state === 'copied'
      ? en
        ? 'Copied.'
        : 'Tersalin.'
      : state === 'downloaded'
      ? en
        ? 'Downloaded.'
        : 'Diunduh.'
      : state === 'select'
      ? en
        ? 'Clipboard unavailable. Select the text below or download .txt.'
        : 'Papan klip tidak tersedia. Pilih teks di bawah atau unduh .txt.'
      : '';

  return (
    <div className="reportExport">
      <div className="actions">
        <Button onClick={copy}>{en ? 'Copy' : 'Salin'}</Button>
        <Button onClick={download}>{en ? 'Download .txt' : 'Unduh .txt'}</Button>
        <small role="status" aria-live="polite" className="exportStatus">
          {statusText}
        </small>
      </div>
      {state === 'select' && (
        <textarea
          ref={fallbackRef}
          readOnly
          rows="6"
          className="copyFallback"
          aria-label={en ? 'Select and copy report' : 'Pilih dan salin laporan'}
          value={text}
          onFocus={(e) => e.target.select()}
        />
      )}
    </div>
  );
}
