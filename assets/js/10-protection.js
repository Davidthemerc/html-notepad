  // ===========================================================================
  // PASSWORD-PROTECTED DOCUMENTS (AES-256-GCM)
  // ===========================================================================

  const PROTECTION_VERSION = 1;
  const PROTECTION_PBKDF2_ITERATIONS = 310000;
  const PROTECTION_MIN_PASSWORD_LENGTH = 7;
  const protectionEncoder = new TextEncoder();
  const protectionDecoder = new TextDecoder();
  const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  function cryptoAvailable() {
    return !!(window.crypto?.subtle && window.crypto?.getRandomValues);
  }

  function randomBytes(length) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return bytes;
  }

  function bytesToBase64(bytes) {
    const value = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < value.length; i += chunk) {
      binary += String.fromCharCode(...value.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function base64ToBytes(value) {
    const binary = atob(String(value || ''));
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }

  function recoveryKeyFromBytes(bytes) {
    let buffer = 0, bitCount = 0, out = '';
    for (const byte of bytes) {
      buffer = (buffer << 8) | byte;
      bitCount += 8;
      while (bitCount >= 5) {
        bitCount -= 5;
        out += RECOVERY_ALPHABET[(buffer >>> bitCount) & 31];
        buffer &= bitCount ? ((1 << bitCount) - 1) : 0;
      }
    }
    if (bitCount) out += RECOVERY_ALPHABET[(buffer << (5 - bitCount)) & 31];
    const groups = out.match(/.{1,4}/g) || [out];
    return `HN1-${groups.join('-')}`;
  }

  function generateRecoveryKey() {
    return recoveryKeyFromBytes(randomBytes(32));
  }

  function normalizeRecoveryKey(value) {
    return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  async function importAes256Key(raw, extractable = true) {
    return crypto.subtle.importKey(
      'raw',
      raw instanceof Uint8Array ? raw : new Uint8Array(raw),
      { name: 'AES-GCM' },
      extractable,
      ['encrypt', 'decrypt']
    );
  }

  async function derivePasswordWrappingKey(password, salt, iterations = PROTECTION_PBKDF2_ITERATIONS) {
    const material = await crypto.subtle.importKey(
      'raw',
      protectionEncoder.encode(String(password)),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name:'PBKDF2', hash:'SHA-256', salt, iterations },
      material,
      { name:'AES-GCM', length:256 },
      false,
      ['encrypt','decrypt']
    );
  }

  async function deriveRecoveryWrappingKey(recoveryKey) {
    const digest = await crypto.subtle.digest(
      'SHA-256',
      protectionEncoder.encode(normalizeRecoveryKey(recoveryKey))
    );
    return importAes256Key(new Uint8Array(digest), false);
  }

  function protectionAad(record, purpose) {
    const protectionId = record?.protection?.protectionId || '';
    return protectionEncoder.encode(`HTMLNotepad|ProtectionV${PROTECTION_VERSION}|${protectionId}|${purpose}`);
  }

  async function encryptBytesWithKey(key, bytes, aad) {
    const iv = randomBytes(12);
    const data = await crypto.subtle.encrypt(
      { name:'AES-GCM', iv, additionalData:aad },
      key,
      bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
    );
    return { iv:bytesToBase64(iv), data:bytesToBase64(new Uint8Array(data)) };
  }

  async function decryptBytesWithKey(key, envelope, aad) {
    const data = await crypto.subtle.decrypt(
      { name:'AES-GCM', iv:base64ToBytes(envelope.iv), additionalData:aad },
      key,
      base64ToBytes(envelope.data)
    );
    return new Uint8Array(data);
  }

  async function encryptJsonWithKey(key, value, aad) {
    return encryptBytesWithKey(key, protectionEncoder.encode(JSON.stringify(value)), aad);
  }

  async function decryptJsonWithKey(key, envelope, aad) {
    const bytes = await decryptBytesWithKey(key, envelope, aad);
    return JSON.parse(protectionDecoder.decode(bytes));
  }

  function isProtectedRecord(record) {
    return !!(
      record &&
      record.type !== 'folder' &&
      record.protected === true &&
      record.protection?.version === PROTECTION_VERSION &&
      record.encrypted?.iv &&
      record.encrypted?.data
    );
  }

  function unlockedProtectedTab(fileId) {
    return tabs.find(tab => tab.fileId === fileId && tab.protected && protectedSessions.has(fileId)) || null;
  }

  function isProtectedFileUnlocked(fileId) {
    return !!unlockedProtectedTab(fileId);
  }

  function protectionGlyphForFile(file) {
    if (!isProtectedRecord(file)) return '';
    return isProtectedFileUnlocked(file.id) ? '🔓' : '🔒';
  }

  function effectiveFileDocument(file) {
    if (!file) return null;
    if (!isProtectedRecord(file)) return file;
    return unlockedProtectedTab(file.id) || file;
  }

  function fileDisplayDocType(file) {
    if (!file) return 'rich';
    if (!isProtectedRecord(file)) return file.docType || 'rich';
    const open = unlockedProtectedTab(file.id);
    return open ? (open.docType || 'rich') : 'protected';
  }

  function fileTypeBadgeLabel(file) {
    const type = fileDisplayDocType(file);
    return type === 'protected' ? 'LOCK' : documentTypeLabel(type);
  }

  function cacheProtectedAssets(fileId, assets = []) {
    const cache = new Map();
    for (const asset of Array.isArray(assets) ? assets : []) {
      if (asset?.id && asset?.dataUrl) cache.set(asset.id, { ...asset });
    }
    protectedAssetCaches.set(fileId, cache);
  }

  function clearProtectedSession(fileId) {
    if (!fileId) return;
    protectedSessions.delete(fileId);
    protectedAssetCaches.delete(fileId);
  }

  function assetIdsInHtml(html) {
    const probe = document.createElement('div');
    probe.innerHTML = html || '';
    return [...new Set([...probe.querySelectorAll('img[data-asset-id]')]
      .map(img => img.dataset.assetId)
      .filter(Boolean))];
  }

  async function buildInitialProtectedPayload(file, tab = null) {
    let content = tab ? tab.content : (file.content || '');
    const docType = tab?.docType || file.docType || 'rich';
    const layout = tab?.layout || file.layout || {left:0,first:0,right:0,tabs:[48]};
    const assets = [];

    if (docType === 'rich' && content) {
      const probe = document.createElement('div');
      probe.innerHTML = content;
      const idMap = new Map();

      for (const image of probe.querySelectorAll('img[data-asset-id]')) {
        const oldId = image.dataset.assetId;
        if (!oldId) continue;
        if (!idMap.has(oldId)) {
          const asset = await storeGet(ASSET_STORE, oldId);
          if (asset?.dataUrl) {
            const newId = uid();
            idMap.set(oldId, newId);
            assets.push({ ...asset, id:newId });
          } else {
            idMap.set(oldId, oldId);
          }
        }
        image.dataset.assetId = idMap.get(oldId);
        image.removeAttribute('src');
      }
      content = probe.innerHTML;
    }

    return {
      payloadVersion: 1,
      content,
      docType,
      layout,
      assets
    };
  }

  async function collectProtectedPayloadFromTab(tab) {
    const cache = protectedAssetCaches.get(tab.fileId) || new Map();
    const assets = [];
    for (const id of assetIdsInHtml(tab.content || '')) {
      let asset = cache.get(id);
      if (!asset) asset = await storeGet(ASSET_STORE, id);
      if (asset?.dataUrl) assets.push({ ...asset, id });
    }
    return {
      payloadVersion: 1,
      content: tab.content || '',
      docType: tab.docType || 'rich',
      layout: tab.layout || {left:0,first:0,right:0,tabs:[48]},
      assets
    };
  }

  async function createProtectedRecord(baseFile, payload, password) {
    if (!cryptoAvailable()) throw new Error('Web Crypto is unavailable.');

    const protectionId = uid();
    const rawDek = randomBytes(32);
    const dekKey = await importAes256Key(rawDek, true);
    const recoveryKey = generateRecoveryKey();
    const salt = randomBytes(16);

    const shell = {
      ...baseFile,
      protected: true,
      docType: 'protected',
      content: '',
      layout: null,
      protection: {
        version: PROTECTION_VERSION,
        algorithm: 'AES-256-GCM',
        protectionId,
        passwordKdf: {
          name: 'PBKDF2',
          hash: 'SHA-256',
          iterations: PROTECTION_PBKDF2_ITERATIONS,
          salt: bytesToBase64(salt)
        }
      },
      encrypted: null
    };

    const passwordKey = await derivePasswordWrappingKey(password, salt, PROTECTION_PBKDF2_ITERATIONS);
    const recoveryWrappingKey = await deriveRecoveryWrappingKey(recoveryKey);

    shell.protection.passwordWrap = await encryptBytesWithKey(
      passwordKey, rawDek, protectionAad(shell, 'password-wrap')
    );
    shell.protection.recoveryWrap = await encryptBytesWithKey(
      recoveryWrappingKey, rawDek, protectionAad(shell, 'recovery-wrap')
    );
    shell.protection.recoveryVault = await encryptBytesWithKey(
      dekKey, protectionEncoder.encode(recoveryKey), protectionAad(shell, 'recovery-vault')
    );
    shell.encrypted = await encryptJsonWithKey(
      dekKey, payload, protectionAad(shell, 'payload')
    );

    return { record:shell, session:{ dekKey, recoveryKey } };
  }

  async function unwrapProtectedRecordWithSecret(record, mode, secret) {
    if (!isProtectedRecord(record)) throw new Error('Not a protected document.');

    let wrappingKey;
    if (mode === 'recovery') {
      const normalized = normalizeRecoveryKey(secret);
      if (!normalized.startsWith('HN1') || normalized.length < 40) throw new Error('Invalid recovery key.');
      wrappingKey = await deriveRecoveryWrappingKey(secret);
    } else {
      const kdf = record.protection.passwordKdf;
      wrappingKey = await derivePasswordWrappingKey(
        secret,
        base64ToBytes(kdf.salt),
        Number(kdf.iterations) || PROTECTION_PBKDF2_ITERATIONS
      );
    }

    const wrap = mode === 'recovery'
      ? record.protection.recoveryWrap
      : record.protection.passwordWrap;
    const rawDek = await decryptBytesWithKey(
      wrappingKey,
      wrap,
      protectionAad(record, mode === 'recovery' ? 'recovery-wrap' : 'password-wrap')
    );
    const dekKey = await importAes256Key(rawDek, true);
    const payload = await decryptJsonWithKey(dekKey, record.encrypted, protectionAad(record, 'payload'));
    const recoveryBytes = await decryptBytesWithKey(
      dekKey,
      record.protection.recoveryVault,
      protectionAad(record, 'recovery-vault')
    );
    const recoveryKey = protectionDecoder.decode(recoveryBytes);

    if (!payload || typeof payload !== 'object' || typeof payload.content !== 'string') {
      throw new Error('Invalid protected payload.');
    }

    return { dekKey, recoveryKey, payload };
  }

  function promptNewProtectionPassword(fileName, { mode='protect' } = {}) {
    if (protectionPasswordResolver) return Promise.resolve(null);
    protectionPasswordMode = mode;
    const change = mode === 'change';
    $('protectionPasswordTitle').textContent = change ? 'Set New Password' : 'Password Protect File';
    $('protectionPasswordMessage').textContent = change
      ? `Create a new password for “${fileName}”. The recovery key will remain unchanged.`
      : `Create an individual password for “${fileName}”.`;
    $('protectionPasswordConfirmBtn').textContent = change ? 'Change Password' : 'Protect';
    $('protectionPasswordInput').value = '';
    $('protectionPasswordConfirmInput').value = '';
    $('protectionPasswordError').textContent = '';
    $('protectionPasswordDialog').showModal();
    setTimeout(() => $('protectionPasswordInput').focus(), 0);
    return new Promise(resolve => { protectionPasswordResolver = resolve; });
  }

  function finishProtectionPasswordDialog(value) {
    if (!protectionPasswordResolver) return;
    const resolve = protectionPasswordResolver;
    protectionPasswordResolver = null;
    if ($('protectionPasswordDialog').open) $('protectionPasswordDialog').close();
    $('protectionPasswordInput').value='';
    $('protectionPasswordConfirmInput').value='';
    resolve(value);
  }

  function submitProtectionPasswordDialog() {
    const password = $('protectionPasswordInput').value;
    const confirm = $('protectionPasswordConfirmInput').value;
    const error = $('protectionPasswordError');

    if (password.length < PROTECTION_MIN_PASSWORD_LENGTH) {
      error.textContent = `Use at least ${PROTECTION_MIN_PASSWORD_LENGTH} characters.`;
      $('protectionPasswordInput').focus();
      return;
    }
    if (password !== confirm) {
      error.textContent = 'The passwords do not match.';
      $('protectionPasswordConfirmInput').focus();
      return;
    }
    error.textContent = '';
    finishProtectionPasswordDialog(password);
  }

  function promptProtectionSecret(fileName, {
    title='Unlock Protected File',
    message='Enter the password for this document.',
    error=''
  } = {}) {
    if (protectionUnlockResolver) return Promise.resolve(null);
    protectionUnlockMode = 'password';
    $('protectionUnlockTitle').textContent = title;
    $('protectionUnlockMessage').textContent = message;
    $('protectionUnlockLabel').textContent = 'Password';
    $('protectionUnlockInput').type = 'password';
    $('protectionUnlockInput').value = '';
    $('protectionUnlockInput').placeholder = '';
    $('protectionUnlockModeBtn').textContent = 'Use Recovery Key';
    $('protectionUnlockNote').textContent = 'The password is used only in memory and is never stored by Notepad.';
    $('protectionUnlockError').textContent = error;
    $('protectionUnlockDialog').dataset.fileName = fileName || '';
    $('protectionUnlockDialog').showModal();
    setTimeout(() => $('protectionUnlockInput').focus(), 0);
    return new Promise(resolve => { protectionUnlockResolver = resolve; });
  }

  function toggleProtectionUnlockMode() {
    protectionUnlockMode = protectionUnlockMode === 'password' ? 'recovery' : 'password';
    const recovery = protectionUnlockMode === 'recovery';
    $('protectionUnlockLabel').textContent = recovery ? 'Recovery key' : 'Password';
    $('protectionUnlockInput').type = recovery ? 'text' : 'password';
    $('protectionUnlockInput').value = '';
    $('protectionUnlockInput').placeholder = recovery ? 'HN1-…' : '';
    $('protectionUnlockModeBtn').textContent = recovery ? 'Use Password' : 'Use Recovery Key';
    $('protectionUnlockNote').textContent = recovery
      ? 'Recovery keys are document-specific and remain valid until you explicitly regenerate them.'
      : 'The password is used only in memory and is never stored by Notepad.';
    $('protectionUnlockError').textContent = '';
    $('protectionUnlockInput').focus();
  }

  function finishProtectionUnlockDialog(value) {
    if (!protectionUnlockResolver) return;
    const resolve = protectionUnlockResolver;
    protectionUnlockResolver = null;
    if ($('protectionUnlockDialog').open) $('protectionUnlockDialog').close();
    $('protectionUnlockInput').value='';
    resolve(value);
  }

  function submitProtectionUnlockDialog() {
    const value = $('protectionUnlockInput').value.trim();
    if (!value) {
      $('protectionUnlockError').textContent =
        protectionUnlockMode === 'recovery' ? 'Enter the recovery key.' : 'Enter the password.';
      return;
    }
    finishProtectionUnlockDialog({ mode:protectionUnlockMode, value });
  }

  async function promptUntilProtectedSecretWorks(record, {
    title='Unlock Protected File',
    message=null
  } = {}) {
    let error = '';
    while (true) {
      const secret = await promptProtectionSecret(record.name, {
        title,
        message: message || `Enter the password for “${record.name}”, or use its recovery key.`,
        error
      });
      if (!secret) return null;
      try {
        return await unwrapProtectedRecordWithSecret(record, secret.mode, secret.value);
      } catch (unlockError) {
        console.warn('Protected document unlock failed:', unlockError);
        error = 'That password or recovery key did not unlock the document.';
      }
    }
  }

  async function showRecoveryKeyDialog(fileName, recoveryKey, {
    initial=false,
    title=null
  } = {}) {
    if (recoveryKeyResolver) return;
    recoveryKeyMustAcknowledge = !!initial;
    recoveryKeyFileName = fileName || 'Protected Document';
    $('recoveryKeyTitle').textContent = title || (initial ? 'Recovery Key Created' : 'Recovery Key');
    $('recoveryKeyMessage').textContent = initial
      ? `Save this recovery key for “${recoveryKeyFileName}”. If both the password and this key are lost, Notepad cannot recover the document.`
      : `Recovery key for “${recoveryKeyFileName}”.`;
    $('recoveryKeyValue').value = recoveryKey;
    $('recoveryKeyDoneBtn').textContent = initial ? 'I Have Saved It' : 'Close';
    $('recoveryKeyDialog').showModal();
    setTimeout(() => $('recoveryKeyValue').focus(), 0);
    return new Promise(resolve => { recoveryKeyResolver = resolve; });
  }

  function finishRecoveryKeyDialog() {
    if (!recoveryKeyResolver) return;
    const resolve = recoveryKeyResolver;
    recoveryKeyResolver = null;
    recoveryKeyMustAcknowledge = false;
    if ($('recoveryKeyDialog').open) $('recoveryKeyDialog').close();
    $('recoveryKeyValue').value='';
    resolve(true);
  }

  async function copyRecoveryKeyToClipboard() {
    const field = $('recoveryKeyValue');
    const value = field.value;
    try {
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(value);
          toast('Recovery key copied.');
          return;
        } catch {
          // file:// and some browser privacy settings deny Clipboard API access;
          // fall through to the local selection/copy path.
        }
      }
      field.focus();
      field.select();
      const copied = document.execCommand('copy');
      field.setSelectionRange(0, 0);
      if (!copied) throw new Error('Copy command was rejected.');
      toast('Recovery key copied.');
    } catch {
      field.focus();
      field.select();
      toast('Copy was blocked. The recovery key is selected so you can copy it manually.');
    }
  }

  function saveRecoveryKeyToDisk() {
    const value = $('recoveryKeyValue').value;
    const filename = safeDiskName(`${recoveryKeyFileName} Recovery Key`, '.txt');
    const body =
      `HTML Notepad Recovery Key\n\nDocument: ${recoveryKeyFileName}\nRecovery Key: ${value}\n\n` +
      `Keep this key somewhere separate from your Notepad data. It can unlock this document if the password is forgotten.\n`;
    downloadBlob(filename, body, 'text/plain;charset=utf-8');
  }

  async function unlockProtectedFileRecord(record) {
    if (!isProtectedRecord(record)) return null;

    const existingSession = protectedSessions.get(record.id);
    if (existingSession) {
      try {
        const payload = await decryptJsonWithKey(
          existingSession.dekKey, record.encrypted, protectionAad(record, 'payload')
        );
        cacheProtectedAssets(record.id, payload.assets || []);
        return { ...existingSession, payload };
      } catch {
        clearProtectedSession(record.id);
      }
    }

    const unlocked = await promptUntilProtectedSecretWorks(record);
    if (!unlocked) return null;
    protectedSessions.set(record.id, {
      dekKey: unlocked.dekKey,
      recoveryKey: unlocked.recoveryKey
    });
    cacheProtectedAssets(record.id, unlocked.payload.assets || []);
    return unlocked;
  }

  async function scrubPlaintextPersistenceForProtectedFile(fileId, protectedRecord) {
    closedTabs = closedTabs.map(entry => entry.fileId === fileId ? {
      fileId,
      name: protectedRecord.name,
      content: '',
      dirty: false,
      createdAt: protectedRecord.createdAt,
      updatedAt: protectedRecord.updatedAt,
      parentId: protectedRecord.parentId || null,
      layout: null,
      scrollTop: 0,
      selection: null,
      docType: 'protected',
      markdownMode: 'edit',
      protected: true
    } : entry);
    writeJsonStorage(LS_CLOSED_TABS, closedTabs);

    const recovery = readJsonStorage(LS_RECOVERY, []);
    if (Array.isArray(recovery)) {
      writeJsonStorage(LS_RECOVERY, recovery.filter(entry => entry?.fileId !== fileId));
    }

    const safetyRecord = await storeGet(SAFETY_STORE, 'preRestore');
    if (safetyRecord?.payload) {
      const snapshot = safetyRecord.payload;
      const prior = (snapshot.files || []).find(item => item?.id === fileId);

      // Restore Safety is historical. Only scrub it when it contains a plaintext
      // version of the file that has just become protected. Once its copy is
      // already encrypted, leave that historical encrypted record untouched.
      if (prior && !isProtectedRecord(prior)) {
        const sensitiveAssetIds = new Set(assetIdsInHtml(prior.content || ''));

        snapshot.files = (snapshot.files || []).map(item =>
          item?.id === fileId ? { ...protectedRecord } : item
        );

        if (snapshot.localStorage) {
          snapshot.localStorage.closedTabs = (snapshot.localStorage.closedTabs || []).map(entry =>
            entry?.fileId === fileId
              ? { fileId, name:protectedRecord.name, content:'', dirty:false, protected:true, docType:'protected' }
              : entry
          );
          snapshot.localStorage.recovery = (snapshot.localStorage.recovery || [])
            .filter(entry => entry?.fileId !== fileId);
        }

        if (sensitiveAssetIds.size && Array.isArray(snapshot.assets)) {
          const otherContent = [
            ...(snapshot.files || []).filter(item => item?.id !== fileId).map(item => item?.content || ''),
            ...(snapshot.localStorage?.unsavedDrafts || []).map(item => item?.content || ''),
            ...(snapshot.localStorage?.closedTabs || []).filter(item => item?.fileId !== fileId).map(item => item?.content || ''),
            ...(snapshot.localStorage?.recovery || []).filter(item => item?.fileId !== fileId).map(item => item?.content || '')
          ].join('\n');
          snapshot.assets = snapshot.assets.filter(asset => {
            if (!sensitiveAssetIds.has(asset?.id)) return true;
            return otherContent.includes(`data-asset-id="${asset.id}"`) ||
              otherContent.includes(`data-asset-id='${asset.id}'`);
          });
        }

        await storePut(SAFETY_STORE, { ...safetyRecord, payload:snapshot });
      }
    }
  }

  async function protectFileById(fileId) {
    const file = await idbGet(fileId);
    if (!file || file.type === 'folder') return;
    if (isProtectedRecord(file)) {
      toast('That document is already password protected.');
      return;
    }
    if (!cryptoAvailable()) {
      toast('This browser does not provide the encryption support required for password protection.');
      return;
    }

    const password = await promptNewProtectionPassword(file.name);
    if (!password) return;

    const tab = tabs.find(item => item.fileId === fileId) || null;
    if (tab?.tabId === activeTabId) captureEditorIntoActive();

    try {
      const payload = await buildInitialProtectedPayload(file, tab);
      const built = await createProtectedRecord({
        ...file,
        updatedAt:new Date().toISOString()
      }, payload, password);

      await idbPut(built.record);
      protectedSessions.set(fileId, built.session);
      cacheProtectedAssets(fileId, payload.assets);

      if (tab) {
        tab.content = payload.content;
        tab.docType = payload.docType;
        tab.layout = payload.layout;
        tab.protected = true;
        tab.dirty = false;
        tab.updatedAt = built.record.updatedAt;
      }

      await scrubPlaintextPersistenceForProtectedFile(fileId, built.record);
      await refreshFiles();
      if (tab?.tabId === activeTabId) restoreTabView(tab);
      else renderTabs();
      await cleanupOrphanAssets();
      if (tab?.tabId === activeTabId) await saveRecoverySnapshot();

      await showRecoveryKeyDialog(file.name, built.session.recoveryKey, { initial:true });

      if (!tab) clearProtectedSession(fileId);
      status(`Password protection enabled for ${file.name}.`);
      toast('Document encrypted.');
    } catch (error) {
      console.error(error);
      clearProtectedSession(fileId);
      toast('Could not password protect the document.');
    }
  }

  async function persistProtectedTab(tab) {
    if (!tab?.protected || !tab.fileId) return false;
    if (tab.tabId === activeTabId) captureEditorIntoActive();

    const session = protectedSessions.get(tab.fileId);
    const record = await idbGet(tab.fileId);
    if (!session || !isProtectedRecord(record)) {
      toast('The protected document is not unlocked.');
      return false;
    }

    const payload = await collectProtectedPayloadFromTab(tab);
    const now = new Date().toISOString();
    const encrypted = await encryptJsonWithKey(
      session.dekKey, payload, protectionAad(record, 'payload')
    );
    const next = {
      ...record,
      encrypted,
      content:'',
      docType:'protected',
      layout:null,
      updatedAt:now
    };
    await idbPut(next);
    tab.dirty = false;
    tab.updatedAt = now;
    await scrubPlaintextPersistenceForProtectedFile(tab.fileId, next);
    return true;
  }

  async function saveProtectedAs(tab) {
    const proposed = tab.name;
    const raw = await askForName({ title:'Save As', initial:proposed });
    if (raw === null) return false;
    const name = normalizeName(raw);
    if (!name) {
      toast('Enter a file name.');
      return false;
    }
    if (name.toLowerCase() === tab.name.toLowerCase()) {
      toast('Choose a different file name for Save As.');
      return false;
    }

    const conflict = files.find(file => file.name.toLowerCase() === name.toLowerCase());
    if (conflict?.type === 'folder') {
      toast('A folder already uses that name.');
      return false;
    }
    if (isProtectedRecord(conflict)) {
      toast('A password-protected file already uses that name. Choose a different name.');
      return false;
    }
    if (conflict && tabs.some(item => item.fileId === conflict.id)) {
      toast('That destination file is currently open. Close it or choose a different name.');
      return false;
    }
    if (conflict && !(await appConfirm(
      `A file named “${conflict.name}” already exists. Replace it?`,
      {title:'Replace File?',confirmText:'Replace',danger:true}
    ))) return false;

    const password = await promptNewProtectionPassword(name);
    if (!password) return false;

    const oldFileId = tab.fileId;
    const payload = await collectProtectedPayloadFromTab(tab);
    const now = new Date().toISOString();
    const targetId = conflict?.id || uid();
    const built = await createProtectedRecord({
      id:targetId,
      type:'file',
      name,
      parentId:tab.parentId || null,
      createdAt:conflict?.createdAt || now,
      updatedAt:now,
      order:Number.isFinite(conflict?.order)
        ? conflict.order
        : (files.length ? Math.max(...files.map(f => Number.isFinite(f.order) ? f.order : -1)) + 1 : 0)
    }, payload, password);

    await idbPut(built.record);
    clearProtectedSession(oldFileId);
    tab.fileId = targetId;
    tab.name = name;
    tab.createdAt = built.record.createdAt;
    tab.updatedAt = now;
    tab.protected = true;
    tab.dirty = false;
    protectedSessions.set(targetId, built.session);
    cacheProtectedAssets(targetId, payload.assets || []);
    await scrubPlaintextPersistenceForProtectedFile(targetId, built.record);
    await refreshFiles();
    renderTabs();
    if (tab.tabId === activeTabId) await saveRecoverySnapshot();
    await showRecoveryKeyDialog(name, built.session.recoveryKey, { initial:true });
    status(`Saved protected copy as ${name}.`);
    return true;
  }

  async function lockAndCloseProtectedFile(fileId) {
    const tab = tabs.find(item => item.fileId === fileId && item.protected);
    if (!tab) {
      clearProtectedSession(fileId);
      toast('Document is already locked.');
      return;
    }
    if (tab.dirty) {
      try {
        if (!(await persistProtectedTab(tab))) return;
      } catch (error) {
        console.error(error);
        toast('Could not save the protected document before locking it.');
        return;
      }
    }
    await closeTab(tab.tabId, { skipPrompt:true, remember:true });
    status(`${tab.name} locked and closed.`);
  }

  async function verifyProtectedCredential(record, title) {
    return promptUntilProtectedSecretWorks(record, {
      title,
      message:`Verify the password for “${record.name}”, or use its recovery key.`
    });
  }

  async function changeProtectedPassword(fileId) {
    const tab = unlockedProtectedTab(fileId);
    const record = await idbGet(fileId);
    if (!tab || !isProtectedRecord(record)) {
      toast('Unlock the document first.');
      return;
    }

    const verified = await verifyProtectedCredential(record, 'Verify Protection');
    if (!verified) return;

    const password = await promptNewProtectionPassword(record.name, { mode:'change' });
    if (!password) return;

    try {
      const rawDek = new Uint8Array(await crypto.subtle.exportKey('raw', protectedSessions.get(fileId).dekKey));
      const salt = randomBytes(16);
      const passwordKey = await derivePasswordWrappingKey(password, salt, PROTECTION_PBKDF2_ITERATIONS);
      const passwordWrap = await encryptBytesWithKey(
        passwordKey, rawDek, protectionAad(record, 'password-wrap')
      );
      record.protection = {
        ...record.protection,
        passwordKdf:{
          name:'PBKDF2',
          hash:'SHA-256',
          iterations:PROTECTION_PBKDF2_ITERATIONS,
          salt:bytesToBase64(salt)
        },
        passwordWrap
      };
      record.updatedAt = new Date().toISOString();
      await idbPut(record);
      await scrubPlaintextPersistenceForProtectedFile(fileId, record);
      await refreshFiles();
      if (tab.tabId === activeTabId) await saveRecoverySnapshot();
      status(`Password changed for ${record.name}.`);
      toast('Password changed. Recovery key unchanged.');
    } catch (error) {
      console.error(error);
      toast('Could not change the password.');
    }
  }

  async function showProtectedRecoveryKey(fileId) {
    const tab = unlockedProtectedTab(fileId);
    const session = protectedSessions.get(fileId);
    if (!tab || !session?.recoveryKey) {
      toast('Unlock the document first.');
      return;
    }
    await showRecoveryKeyDialog(tab.name, session.recoveryKey);
  }

  async function regenerateProtectedRecoveryKey(fileId) {
    const tab = unlockedProtectedTab(fileId);
    const session = protectedSessions.get(fileId);
    const record = await idbGet(fileId);
    if (!tab || !session || !isProtectedRecord(record)) {
      toast('Unlock the document first.');
      return;
    }

    const confirmed = await appConfirm(
      `Regenerate the recovery key for “${record.name}”? The existing recovery key will permanently stop working.`,
      { title:'Regenerate Recovery Key?', confirmText:'Regenerate', danger:true }
    );
    if (!confirmed) return;

    try {
      const newRecoveryKey = generateRecoveryKey();
      const recoveryWrappingKey = await deriveRecoveryWrappingKey(newRecoveryKey);
      const rawDek = new Uint8Array(await crypto.subtle.exportKey('raw', session.dekKey));
      record.protection = {
        ...record.protection,
        recoveryWrap:await encryptBytesWithKey(
          recoveryWrappingKey, rawDek, protectionAad(record, 'recovery-wrap')
        ),
        recoveryVault:await encryptBytesWithKey(
          session.dekKey,
          protectionEncoder.encode(newRecoveryKey),
          protectionAad(record, 'recovery-vault')
        )
      };
      record.updatedAt = new Date().toISOString();
      await idbPut(record);
      await scrubPlaintextPersistenceForProtectedFile(fileId, record);
      session.recoveryKey = newRecoveryKey;
      await refreshFiles();
      if (tab.tabId === activeTabId) await saveRecoverySnapshot();
      await showRecoveryKeyDialog(record.name, newRecoveryKey, {
        initial:true,
        title:'Recovery Key Regenerated'
      });
      status(`Recovery key regenerated for ${record.name}.`);
    } catch (error) {
      console.error(error);
      toast('Could not regenerate the recovery key.');
    }
  }

  async function materializeProtectedPayloadAssets(payload) {
    if (payload.docType !== 'rich' || !Array.isArray(payload.assets) || !payload.assets.length) {
      return { ...payload };
    }

    const probe = document.createElement('div');
    probe.innerHTML = payload.content || '';
    const idMap = new Map();

    for (const asset of payload.assets) {
      if (!asset?.id || !asset?.dataUrl) continue;
      let targetId = asset.id;
      if (await storeGet(ASSET_STORE, targetId)) targetId = uid();
      idMap.set(asset.id, targetId);
      await storePut(ASSET_STORE, { ...asset, id:targetId });
    }

    for (const image of probe.querySelectorAll('img[data-asset-id]')) {
      const replacement = idMap.get(image.dataset.assetId);
      if (replacement) image.dataset.assetId = replacement;
      image.removeAttribute('src');
    }

    return { ...payload, content:probe.innerHTML };
  }

  async function removeProtectedFileProtection(fileId) {
    const tab = unlockedProtectedTab(fileId);
    const record = await idbGet(fileId);
    if (!tab || !isProtectedRecord(record)) {
      toast('Unlock the document first.');
      return;
    }

    const verified = await verifyProtectedCredential(record, 'Remove Password Protection');
    if (!verified) return;

    const confirmed = await appConfirm(
      `Remove password protection from “${record.name}”? The document and its images will be stored normally in IndexedDB.`,
      { title:'Remove Password Protection?', confirmText:'Remove Protection', danger:true }
    );
    if (!confirmed) return;

    try {
      if (tab.tabId === activeTabId) captureEditorIntoActive();
      let payload = await collectProtectedPayloadFromTab(tab);
      payload = await materializeProtectedPayloadAssets(payload);
      const now = new Date().toISOString();
      const plain = {
        id:record.id,
        type:'file',
        name:record.name,
        parentId:record.parentId || null,
        content:payload.content || '',
        docType:payload.docType || 'rich',
        layout:payload.layout || {left:0,first:0,right:0,tabs:[48]},
        createdAt:record.createdAt || now,
        updatedAt:now,
        order:Number.isFinite(record.order) ? record.order : files.findIndex(file => file.id === record.id)
      };
      await idbPut(plain);

      tab.content = plain.content;
      tab.docType = plain.docType;
      tab.layout = plain.layout;
      tab.protected = false;
      tab.dirty = false;
      tab.updatedAt = now;
      clearProtectedSession(fileId);
      await refreshFiles();
      if (tab.tabId === activeTabId) restoreTabView(tab);
      else renderTabs();
      await saveRecoverySnapshot();
      status(`Password protection removed from ${record.name}.`);
      toast('Document is no longer encrypted.');
    } catch (error) {
      console.error(error);
      toast('Could not remove password protection.');
    }
  }

  async function saveCurrent(saveAs = false) {
    captureEditorIntoActive();
    const tab = currentTab();
    if (!tab) return;

    if (tab.protected && tab.fileId) {
      try {
        if (saveAs) {
          await saveProtectedAs(tab);
          return;
        }
        if (!(await persistProtectedTab(tab))) return;
        await refreshFiles();
        renderTabs();
        persistUnsavedDrafts();
        await saveRecoverySnapshot();
        status(`Saved ${tab.name}.`);
        toast('Saved encrypted document.');
      } catch (error) {
        console.error(error);
        toast('Could not save the protected document.');
      }
      return;
    }

    if (!tab.fileId || saveAs) {
      const proposed = tab.fileId ? tab.name : (tab.name.startsWith('Untitled') ? '' : tab.name);
      const raw = await askForName({ title: saveAs ? 'Save As' : 'Save', initial: proposed });
      if (raw === null) return;
      const name = normalizeName(raw);
      if (!name) { toast('Enter a file name.'); return saveCurrent(saveAs); }

      const conflict = files.find(f => f.name.toLowerCase() === name.toLowerCase() && f.id !== tab.fileId);
      if (isProtectedRecord(conflict)) {
        toast('A password-protected file already uses that name. Choose a different name.');
        return;
      }
      if (conflict) {
        if (!(await appConfirm(`A file named “${conflict.name}” already exists. Replace it?`,{title:'Replace File?',confirmText:'Replace',danger:true}))) return;
        const now = new Date().toISOString();
        const replacement = { ...conflict, name, content: tab.content, docType:tab.docType||'rich', updatedAt: now };
        await idbPut(replacement);
        if (tab.fileId && tab.fileId !== conflict.id && saveAs) {
          // Save As should leave the original file intact; the current tab simply points to the replacement target.
        }
        tab.fileId = conflict.id;
        tab.name = name;
        tab.isNew = false;
        tab.dirty = false;
        tab.updatedAt = now;
      } else {
        const now = new Date().toISOString();
        const file = {
          id: saveAs || !tab.fileId ? uid() : tab.fileId,
          type:'file', docType:tab.docType||'rich', parentId: tab.parentId || null,
          name,
          content: tab.content, layout:tab.layout,
          createdAt: (saveAs || !tab.fileId) ? now : tab.createdAt,
          updatedAt: now,
          order: files.length ? Math.max(...files.map(f => Number.isFinite(f.order) ? f.order : -1)) + 1 : 0
        };
        await idbPut(file);
        tab.fileId = file.id;
        tab.name = file.name;
        tab.isNew = false;
        tab.dirty = false;
        tab.createdAt = file.createdAt;
        tab.updatedAt = file.updatedAt;
      }
    } else {
      const existing = await idbGet(tab.fileId);
      const now = new Date().toISOString();
      const file = {
        id: tab.fileId,
        type:'file', docType:tab.docType||existing?.docType||'rich', parentId: existing?.parentId || tab.parentId || null,
        name: tab.name,
        content: tab.content, layout:tab.layout,
        createdAt: existing?.createdAt || tab.createdAt || now,
        updatedAt: now,
        order: Number.isFinite(existing?.order) ? existing.order : files.findIndex(f => f.id === tab.fileId)
      };
      await idbPut(file);
      tab.dirty = false;
      tab.updatedAt = now;
    }

    await refreshFiles();
    renderTabs();
    persistUnsavedDrafts();
    saveRecoverySnapshot();
    status(`Saved ${tab.name}.`);
    toast('Saved to virtual filesystem.');
  }

  async function renameSelected() {
    const file = requireSingleFilesystemSelection('rename it');
    if (!file) return;
    selectedFileId = file.id;
    const raw = await askForName({ title: 'Rename File', initial: file.name, confirmText: 'Rename' });
    if (raw === null) return;
    const name = normalizeName(raw);
    if (!name) { toast('Enter a file name.'); return; }
    const conflict = files.find(f => f.id !== file.id && f.name.toLowerCase() === name.toLowerCase());
    if (conflict) { toast('Another file already has that name.'); return; }
    file.name = name;
    file.updatedAt = new Date().toISOString();
    await idbPut(file);
    for (const tab of tabs.filter(t => t.fileId === file.id)) tab.name = name;
    await refreshFiles();
    renderTabs();
    status(`Renamed file to ${name}.`);
  }

  async function deleteSelected() {
    await moveSelectionToTrash();
  }
