import { useCallback, useEffect, useRef, useState } from 'react';
import { officeApi } from './api';

// Saves this long after the last change.
const SAVE_DELAY_MS = 1000;

// Keeps one open Office document in step with the server: loads it, autosaves
// title, content and page setup after a pause, and refuses to overwrite a
// version changed somewhere else (the user then picks which version to keep).
// The editor registers how to read its content with setContentGetter().
export default function useDocumentSync(docId, { onError }) {
  const [doc, setDoc] = useState(null);
  const [title, setTitleState] = useState('');
  const [settings, setSettingsState] = useState(null);
  // saved | unsaved | saving | error | conflict
  const [status, setStatus] = useState('saved');
  // Changes whenever the content is (re)loaded from the server, to remount the editor.
  const [loadKey, setLoadKey] = useState(0);

  const getContent = useRef(null);
  const titleRef = useRef('');
  const settingsRef = useRef(null);
  const versionRef = useRef(0);
  const dirty = useRef(false);
  const saving = useRef(false);
  const again = useRef(false);
  const conflict = useRef(false);
  const timer = useRef(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const apply = useCallback((d) => {
    versionRef.current = d.version;
    titleRef.current = d.title;
    settingsRef.current = d.settings;
    dirty.current = false;
    conflict.current = false;
    setDoc(d);
    setTitleState(d.title);
    setSettingsState(d.settings);
    setStatus('saved');
    setLoadKey((k) => k + 1);
  }, []);

  const load = useCallback(async () => {
    const { document } = await officeApi.get(docId);
    apply(document);
    return document;
  }, [docId, apply]);

  useEffect(() => {
    load().catch((err) => onErrorRef.current(err, 'load'));
  }, [load]);

  const payload = () => ({
    title: titleRef.current,
    content: getContent.current(),
    settings: settingsRef.current,
    version: versionRef.current,
  });

  const save = useCallback(async () => {
    clearTimeout(timer.current);
    if (conflict.current || !dirty.current || !getContent.current) return;
    if (saving.current) {
      again.current = true;
      return;
    }
    saving.current = true;
    dirty.current = false;
    setStatus('saving');
    try {
      const { document } = await officeApi.update(docId, payload());
      versionRef.current = document.version;
      setDoc((d) => ({ ...d, ...document, content: d?.content }));
      setStatus(dirty.current ? 'unsaved' : 'saved');
    } catch (err) {
      dirty.current = true;
      if (err?.response?.data?.error?.code === 'VERSION_CONFLICT') {
        conflict.current = true;
        setStatus('conflict');
      } else {
        setStatus('error');
        onErrorRef.current(err, 'save');
      }
    } finally {
      saving.current = false;
      if (again.current) {
        again.current = false;
        if (dirty.current && !conflict.current) timer.current = setTimeout(save, 0);
      }
    }
  }, [docId]);

  const markDirty = useCallback(() => {
    dirty.current = true;
    if (conflict.current) return;
    setStatus('unsaved');
    clearTimeout(timer.current);
    timer.current = setTimeout(save, SAVE_DELAY_MS);
  }, [save]);

  const setTitle = useCallback((value) => {
    titleRef.current = value;
    setTitleState(value);
    markDirty();
  }, [markDirty]);

  const setSettings = useCallback((value) => {
    settingsRef.current = value;
    setSettingsState(value);
    markDirty();
  }, [markDirty]);

  // Saves what's pending when leaving, and warns before closing the tab with unsaved changes.
  useEffect(() => {
    const warn = (e) => {
      if (dirty.current || saving.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
      clearTimeout(timer.current);
      if (dirty.current && !conflict.current && !saving.current && getContent.current) {
        try {
          officeApi.update(docId, payload()).catch(() => {});
        } catch {
          // The editor is already gone; nothing more to save.
        }
      }
    };
    // payload reads refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  const takeLatest = useCallback(() => load().catch((err) => onErrorRef.current(err, 'load')), [load]);

  const keepMine = useCallback(async () => {
    try {
      const { document } = await officeApi.get(docId);
      versionRef.current = document.version;
      conflict.current = false;
      dirty.current = true;
      await save();
    } catch (err) {
      onErrorRef.current(err, 'save');
    }
  }, [docId, save]);

  // Folder moves don't touch the content, so they skip versioning.
  const moveTo = useCallback(async (folderId) => {
    const { document } = await officeApi.update(docId, { folderId });
    setDoc((d) => ({ ...d, folderId: document.folderId }));
  }, [docId]);

  const setContentGetter = useCallback((fn) => {
    getContent.current = fn;
  }, []);

  return {
    doc, title, settings, status, loadKey,
    setTitle, setSettings, markDirty, save, takeLatest, keepMine, moveTo, setContentGetter,
    hasPendingChanges: () => dirty.current || saving.current,
  };
}
