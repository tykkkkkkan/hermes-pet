const fs = require('fs');
const path = require('path');

const DEFAULT_SETTINGS = {
  userName: '好大爹',
  petName: '赫尔墨兹',
  persona: '你是 Hermes 的专属桌宠。你是可靠、机灵、略带执事感的伙伴，说话直接但有分寸。你会主动关心主人正在做的事，优先给出能执行的下一步，不说空话。',
  apiBase: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  apiKeyCipher: '',
  petScale: 100,
  petOpacity: 100,
  lineFrequency: 'normal',
  voiceEnabled: true,
  voiceName: '',
  voiceRate: 100,
  voiceVolume: 85,
  dndEnabled: false,
  dndStart: '23:30',
  dndEnd: '08:00',
  dndAllowApproval: true
};

module.exports = function createSettingsStore({ dataDir, safeStorage, hermesDir, defaults, onSave, logger } = {}) {
  const getDataDir = typeof dataDir === 'function' ? dataDir : () => String(dataDir || '');
  const baseDefaults = { ...(defaults === undefined ? DEFAULT_SETTINGS : (defaults || {})) };

  function readJson(file, fallback) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    } catch (error) {
      if (error?.code !== 'ENOENT') logger?.warn(`[json-file] 读取失败，已回落默认值：${file}`, error.message);
      return fallback;
    }
  }

  function writeJson(file, value) {
    const tmp = `${file}.tmp`;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
      fs.renameSync(tmp, file);
      return true;
    } catch {
      try { fs.unlinkSync(tmp); } catch {}
      return false;
    }
  }

  function settingsFile() {
    return path.join(getDataDir(), 'settings.json');
  }

  function historyFile() {
    return path.join(getDataDir(), 'memory', 'chat.json');
  }

  function stateFile() {
    return path.join(getDataDir(), 'memory', 'state.json');
  }

  function load() {
    return { ...baseDefaults, ...(readJson(settingsFile(), {}) || {}) };
  }

  function getApiKey(settings = load()) {
    if (!settings.apiKeyCipher || !safeStorage?.isEncryptionAvailable?.()) return '';
    try {
      return safeStorage.decryptString(Buffer.from(settings.apiKeyCipher, 'base64'));
    } catch {
      return '';
    }
  }

  function importFromHermes() {
    const envPath = path.join(hermesDir || '', '.env');
    try {
      if (!fs.existsSync(envPath)) return { ok: false, reason: '没找到 Hermes 的 .env' };
      const raw = fs.readFileSync(envPath, 'utf8');
      const pick = (name) => {
        const m = raw.match(new RegExp('^\\s*' + name + '\\s*=\\s*(.+)$', 'm'));
        return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
      };
      const key = pick('DEEPSEEK_API_KEY');
      if (!key) return { ok: false, reason: '.env 里没有 DEEPSEEK_API_KEY' };
      if (!safeStorage?.isEncryptionAvailable?.()) return { ok: false, reason: '系统加密存储不可用' };

      const base = pick('DEEPSEEK_API_BASE') || 'https://api.deepseek.com/v1';
      const current = load();
      const next = {
        ...current,
        apiBase: base,
        model: current.model || 'deepseek-chat',
        apiKeyCipher: safeStorage.encryptString(key).toString('base64')
      };
      writeJson(settingsFile(), next);
      console.log('[hermes-pet] 已从 Hermes 导入密钥');
      return { ok: true, base, keyLength: key.length };
    } catch (error) {
      return { ok: false, reason: error.message };
    }
  }

  function save(input = {}) {
    const current = load();
    const clamp = (value, lo, hi, fallback) => {
      const number = Number(value);
      if (!Number.isFinite(number)) return fallback;
      return Math.max(lo, Math.min(hi, Math.round(number)));
    };
    const pickEnum = (value, list, fallback) => (list.includes(value) ? value : fallback);
    const pickTime = (value, fallback) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || '')) ? String(value) : fallback);
    const next = {
      ...current,
      userName: String(input.userName || current.userName).trim().slice(0, 40) || baseDefaults.userName,
      petName: String(input.petName || current.petName).trim().slice(0, 40) || baseDefaults.petName,
      persona: String(input.persona || current.persona).trim().slice(0, 1200) || baseDefaults.persona,
      apiBase: String(input.apiBase || current.apiBase).trim().replace(/\/+$/, '') || baseDefaults.apiBase,
      model: String(input.model || current.model).trim().slice(0, 100) || baseDefaults.model,
      petScale: clamp(input.petScale, 70, 140, current.petScale ?? 100),
      petOpacity: clamp(input.petOpacity, 40, 100, current.petOpacity ?? 100),
      lineFrequency: pickEnum(input.lineFrequency, ['quiet', 'normal', 'chatty'], current.lineFrequency || 'normal'),
      voiceEnabled: input.voiceEnabled == null ? !!current.voiceEnabled : !!input.voiceEnabled,
      voiceName: String(input.voiceName == null ? current.voiceName || '' : input.voiceName).slice(0, 120),
      voiceRate: clamp(input.voiceRate, 70, 130, current.voiceRate ?? 100),
      voiceVolume: clamp(input.voiceVolume, 0, 100, current.voiceVolume ?? 85),
      dndEnabled: input.dndEnabled == null ? !!current.dndEnabled : !!input.dndEnabled,
      dndStart: pickTime(input.dndStart, current.dndStart || '23:30'),
      dndEnd: pickTime(input.dndEnd, current.dndEnd || '08:00'),
      dndAllowApproval: input.dndAllowApproval == null ? current.dndAllowApproval !== false : !!input.dndAllowApproval
    };
    if (input.apiKey && String(input.apiKey).trim()) {
      if (safeStorage?.isEncryptionAvailable?.()) {
        next.apiKeyCipher = safeStorage.encryptString(String(input.apiKey).trim()).toString('base64');
      }
    } else if (input.clearApiKey) {
      next.apiKeyCipher = '';
    }
    writeJson(settingsFile(), next);
    onSave?.();
    return next;
  }

  function publicView() {
    const settings = load();
    return {
      userName: settings.userName,
      petName: settings.petName,
      persona: settings.persona,
      apiBase: settings.apiBase,
      model: settings.model,
      hasApiKey: !!settings.apiKeyCipher,
      petScale: settings.petScale ?? 100,
      petOpacity: settings.petOpacity ?? 100,
      lineFrequency: settings.lineFrequency || 'normal',
      voiceEnabled: settings.voiceEnabled !== false,
      voiceName: settings.voiceName || '',
      voiceRate: settings.voiceRate ?? 100,
      voiceVolume: settings.voiceVolume ?? 85,
      dndEnabled: !!settings.dndEnabled,
      dndStart: settings.dndStart || '23:30',
      dndEnd: settings.dndEnd || '08:00',
      dndAllowApproval: settings.dndAllowApproval !== false
    };
  }

  return {
    dataDir: getDataDir,
    readJson,
    writeJson,
    settingsFile,
    historyFile,
    stateFile,
    load,
    save,
    getApiKey,
    importFromHermes,
    publicView
  };
};
