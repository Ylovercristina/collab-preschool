// ---------- Settings: Backup & Restore (System Administrator only) ----------
const BACKUP_TYPE_LABELS = {
  manual: ['Manual', 'approved'],
  auto: ['Automatic', 'pending'],
  'pre-restore': ['Safety (before restore)', 'archived'],
  uploaded: ['Uploaded', 'pending'],
};

function formatBackupSize(bytes) {
  if (!bytes && bytes !== 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function loadBackups() {
  const tbody = document.getElementById('backupsTbody');
  const message = document.getElementById('backupMessage');
  if (!tbody) return;
  try {
    const { backups, keep } = await api.get('/backups');
    document.getElementById('backupKeepAuto').textContent = keep.auto;
    tbody.innerHTML = backups.length ? backups.map((backup) => {
      const [label, badge] = BACKUP_TYPE_LABELS[backup.type] || [backup.type, 'pending'];
      return `<tr>
        <td><strong>${escapeDashboardHtml(new Date(backup.createdAt).toLocaleString())}</strong>
          <div class="archived-account-email">${backup.createdBy ? `by ${escapeDashboardHtml(backup.createdBy)}` : ''}${backup.originalCreatedAt ? ` · taken ${escapeDashboardHtml(new Date(backup.originalCreatedAt).toLocaleString())}` : ''}</div></td>
        <td><span class="badge ${badge}">${escapeDashboardHtml(label)}</span></td>
        <td>${backup.documents != null ? `${backup.documents.toLocaleString()} <span class="archived-account-email">in ${backup.collections} collections</span>` : '—'}</td>
        <td>${formatBackupSize(backup.size)}</td>
        <td style="text-align:right; white-space:nowrap;">
          <button type="button" class="btn btn-ghost btn-sm" data-backup-download="${escapeDashboardHtml(backup.fileName)}"><i class="fa-solid fa-download"></i> Download</button>
          <button type="button" class="btn btn-secondary btn-sm" data-backup-restore="${escapeDashboardHtml(backup.fileName)}"><i class="fa-solid fa-clock-rotate-left"></i> Restore</button>
          <button type="button" class="btn btn-ghost btn-sm archived-delete-button" data-backup-delete="${escapeDashboardHtml(backup.fileName)}" title="Delete backup"><i class="fa-solid fa-trash"></i></button>
        </td>
      </tr>`;
    }).join('') : '<tr><td colspan="5"><div class="empty-state"><i class="fa-solid fa-database"></i><p>No backups yet. Click "Back up now" to create the first one.</p></div></td></tr>';

    tbody.querySelectorAll('[data-backup-download]').forEach((button) => button.addEventListener('click', () => downloadBackup(button.dataset.backupDownload, button)));
    tbody.querySelectorAll('[data-backup-restore]').forEach((button) => button.addEventListener('click', () => {
      const backup = backups.find((item) => item.fileName === button.dataset.backupRestore);
      openRestoreDialog({ fileName: backup.fileName, label: new Date(backup.originalCreatedAt || backup.createdAt).toLocaleString() });
    }));
    tbody.querySelectorAll('[data-backup-delete]').forEach((button) => button.addEventListener('click', async () => {
      if (!confirm('Delete this backup file? This cannot be undone.')) return;
      try {
        await api.del(`/backups/${encodeURIComponent(button.dataset.backupDelete)}`);
        showToast('Backup deleted.', 'info');
        await loadBackups();
      } catch (err) {
        showMsg(message, err.message);
      }
    }));
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="5">Backups could not be loaded.</td></tr>';
    showMsg(message, err.message);
  }
}

// Downloads need the sign-in token, so the file is fetched and saved through a blob link.
async function downloadBackup(fileName, button) {
  button.disabled = true;
  try {
    const response = await fetch(`${API_BASE}/backups/${encodeURIComponent(fileName)}/download`, {
      headers: { Authorization: `Bearer ${Auth.getToken()}` },
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error((data && data.message) || 'The backup could not be downloaded.');
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) {
    showMsg(document.getElementById('backupMessage'), err.message);
  } finally {
    button.disabled = false;
  }
}

function openRestoreDialog({ fileName, label }) {
  Modal.open(`
    <h3><i class="fa-solid fa-triangle-exclamation" style="color:#DC2626;"></i> Restore database</h3>
    <div class="archived-accounts-notice" style="margin-top:10px;">
      <i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>
      <p>This replaces <strong>all current data</strong> (accounts, students, attendance, progress, fees, messages…) with the backup from <strong>${escapeDashboardHtml(label)}</strong>. Anything added after that backup will be lost. A safety backup of the current data is saved first, so you can undo this from the list.</p>
    </div>
    <div id="restoreMsg" class="form-msg"></div>
    <form id="restoreForm">
      <div class="field"><label for="restorePassword">Your password</label><input type="password" id="restorePassword" autocomplete="current-password" required /></div>
      <div class="field"><label for="restoreConfirm">Type <strong>RESTORE</strong> to confirm</label><input id="restoreConfirm" autocomplete="off" required /></div>
      <div class="event-form-actions"><button type="button" class="btn btn-ghost" id="restoreCancel">Cancel</button><button type="submit" class="btn btn-danger" id="restoreSubmit"><i class="fa-solid fa-clock-rotate-left"></i> Restore database</button></div>
    </form>`);
  document.getElementById('restoreCancel').addEventListener('click', () => Modal.close());
  document.getElementById('restoreForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = document.getElementById('restoreMsg');
    const confirmText = document.getElementById('restoreConfirm').value.trim();
    if (confirmText !== 'RESTORE') {
      showMsg(message, 'Type RESTORE to confirm.');
      return;
    }
    const button = document.getElementById('restoreSubmit');
    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Restoring… do not close this page';
    try {
      const result = await api.post(`/backups/${encodeURIComponent(fileName)}/restore`, {
        password: document.getElementById('restorePassword').value,
        confirm: confirmText,
      });
      Modal.close();
      alert(`${result.message}\n\nThe page will reload so everything shows the restored data. If your account was not in that backup, you will be asked to sign in again.`);
      window.location.reload();
    } catch (err) {
      showMsg(message, err.message);
      button.disabled = false;
      button.innerHTML = '<i class="fa-solid fa-clock-rotate-left"></i> Restore database';
    }
  });
}

function initBackupSettings() {
  document.getElementById('createBackupBtn')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    const original = button.innerHTML;
    button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Backing up…';
    try {
      const result = await api.post('/backups', {});
      showToast(`${result.message} ${result.backup.documents.toLocaleString()} records saved.`);
      await loadBackups();
    } catch (err) {
      showMsg(document.getElementById('backupMessage'), err.message);
    } finally {
      button.disabled = false;
      button.innerHTML = original;
    }
  });

  const input = document.getElementById('backupUploadFile');
  const dropzone = document.getElementById('backupDropzone');
  const uploadButton = document.getElementById('backupUploadBtn');
  let chosenFile = null;

  const showChosenFile = (file) => {
    const valid = file && /\.(json\.gz|gz|json)$/i.test(file.name);
    chosenFile = valid ? file : null;
    document.getElementById('backupFileName').textContent = chosenFile ? chosenFile.name : 'Choose a backup file';
    document.getElementById('backupFileHint').textContent = chosenFile
      ? `${formatBackupSize(chosenFile.size)} · click to choose a different file`
      : file ? 'That is not a backup file. Choose a .json.gz or .json file.' : 'or drag it here · .json.gz or .json, up to 250 MB';
    dropzone.classList.toggle('has-file', Boolean(chosenFile));
    dropzone.classList.toggle('is-invalid', Boolean(file && !chosenFile));
    uploadButton.disabled = !chosenFile;
  };

  input?.addEventListener('change', () => showChosenFile(input.files && input.files[0]));
  ['dragenter', 'dragover'].forEach((type) => dropzone?.addEventListener(type, (event) => {
    event.preventDefault();
    dropzone.classList.add('is-dragging');
  }));
  ['dragleave', 'drop'].forEach((type) => dropzone?.addEventListener(type, (event) => {
    event.preventDefault();
    dropzone.classList.remove('is-dragging');
  }));
  dropzone?.addEventListener('drop', (event) => showChosenFile(event.dataTransfer.files && event.dataTransfer.files[0]));

  document.getElementById('backupUploadForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!chosenFile) return;
    uploadButton.disabled = true;
    const original = uploadButton.innerHTML;
    uploadButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Checking…';
    try {
      const form = new FormData();
      form.append('backup', chosenFile);
      const result = await apiRequest('/backups/upload', { method: 'POST', body: form });
      showToast(result.message);
      input.value = '';
      showChosenFile(null);
      await loadBackups();
    } catch (err) {
      showMsg(document.getElementById('backupMessage'), err.message);
      uploadButton.disabled = false;
    } finally {
      uploadButton.innerHTML = original;
    }
  });
}

initBackupSettings();
