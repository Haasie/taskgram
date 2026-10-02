import { useEffect, useState } from 'react';
import { Globe, Loader2, LogOut, Send, Settings, User, X } from 'lucide-react';
import { api, type AuthInfo } from '../lib/api.js';
import { outboxEngine, queryClient } from '../lib/queries.js';
import { clear as clearLocalData } from 'idb-keyval';
import { currentSubscription, disablePush, enablePush, isIos, isStandalone, pushSupported } from '../lib/push.js';
import { showToast } from '../lib/toast.js';
import { Modal } from './Modal.js';
import { getLang, setLang, t, useLang } from '../i18n/index.js';

export function SettingsDialog({
  open,
  onClose,
  auth
}: {
  open: boolean;
  onClose: () => void;
  auth?: AuthInfo | null;
}) {
  const lang = useLang();
  const [loading, setLoading] = useState(true);
  const [serverEnabled, setServerEnabled] = useState(false);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [subEndpoint, setSubEndpoint] = useState<string | null>(null);
  const [digestEnabled, setDigestEnabled] = useState(true);
  const [digestTime, setDigestTime] = useState('07:30');
  const [testing, setTesting] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);

    async function load() {
      try {
        const config = await api.pushConfig();
        if (cancelled) return;
        setServerEnabled(config.enabled);
        setPublicKey(config.publicKey);
        if (config.settings) {
          setDigestEnabled(config.settings.digestEnabled);
          setDigestTime(config.settings.digestTime);
        }
        if (config.enabled && pushSupported()) {
          const sub = await currentSubscription();
          if (cancelled) return;
          setSubscribed(Boolean(sub));
          setSubEndpoint(sub?.endpoint ?? null);
        }
      } catch (err) {
        console.error('[settings] Failed to load push config:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const onLanguageChange = async (newLang: 'nl' | 'en') => {
    setLang(newLang);
    if (serverEnabled) {
      try {
        await api.savePushSettings({ language: newLang });
      } catch (err) {
        console.error('[settings] Failed to sync push language:', err);
      }
    }
  };

  const onToggleSubscription = async () => {
    if (subscribing) return;
    setSubscribing(true);
    try {
      if (subscribed) {
        await disablePush();
        setSubscribed(false);
        setSubEndpoint(null);
        showToast(t('toast.notificationsDisabled'));
      } else {
        if (!publicKey) throw new Error(t('toast.noPublicKey'));
        const sub = await enablePush(publicKey);
        setSubscribed(true);
        setSubEndpoint(sub.endpoint);
        showToast(t('toast.notificationsEnabled'));
      }
    } catch (err: any) {
      console.error('[settings] Error toggling push:', err);
      showToast(err?.message ?? t('toast.toggleError'));
    } finally {
      setSubscribing(false);
    }
  };

  const onToggleDigest = async (enabled: boolean) => {
    setDigestEnabled(enabled);
    try {
      await api.savePushSettings({ digestEnabled: enabled, digestTime, language: getLang() });
    } catch (err) {
      console.error('[settings] Failed to save digest setting:', err);
      showToast(t('toast.saveError'));
    }
  };

  const onChangeDigestTime = async (time: string) => {
    setDigestTime(time);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return;
    try {
      await api.savePushSettings({ digestEnabled, digestTime: time, language: getLang() });
    } catch (err) {
      console.error('[settings] Failed to save digest time:', err);
      showToast(t('toast.saveError'));
    }
  };

  const onSendTest = async () => {
    if (!subEndpoint || testing) return;
    setTesting(true);
    try {
      await api.testPush(subEndpoint);
      showToast(t('toast.testSent'));
    } catch (err) {
      console.error('[settings] Failed to send test push:', err);
      showToast(t('toast.testError'));
    } finally {
      setTesting(false);
    }
  };

  const onLogout = async () => {
    if (loggingOut) return;
    const pending = outboxEngine.pending().length;
    if (pending > 0 && !window.confirm(t('settings.logoutPending', { count: pending }))) return;
    setLoggingOut(true);
    try {
      await api.logout();
    } catch (err) {
      console.error('[settings] Logout error:', err);
    } finally {
      // Lokale kopie van taken, wachtrij en conflicten van dit apparaat verwijderen.
      queryClient.clear();
      await clearLocalData().catch(() => undefined);
      window.location.reload();
    }
  };

  const showIosHint = isIos() && !isStandalone();
  const showLogout = auth?.user && (auth.mode === 'password' || auth.mode === 'oidc');

  return (
    <Modal open={open} onClose={onClose} label={t('settings.title')}>
      <div className="p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold">
            <Settings size={18} className="text-zinc-600 dark:text-zinc-300" />
            <span>{t('settings.title')}</span>
          </div>
          <button type="button" onClick={onClose} className="icon-btn text-zinc-400" aria-label={t('settings.close')}>
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          {/* User info & logout */}
          {auth?.user && (
            <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <User size={16} className="text-zinc-500" />
                <div>
                  <p className="text-xs text-zinc-400">{t('settings.user')}</p>
                  <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{auth.user}</p>
                </div>
              </div>
              {showLogout && (
                <button
                  type="button"
                  onClick={onLogout}
                  disabled={loggingOut}
                  className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 hover:text-rose-600 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  <LogOut size={13} />
                  <span>{t('settings.logout')}</span>
                </button>
              )}
            </div>
          )}

          {/* Language selector */}
          <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <label className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                <Globe size={16} className="text-zinc-500" />
                {t('settings.language')}
              </span>
              <select
                aria-label={t('settings.language')}
                value={lang}
                onChange={(e) => void onLanguageChange(e.target.value as 'nl' | 'en')}
                className="input text-sm py-1 px-2.5 rounded-md"
              >
                <option value="nl">{t('settings.langNl')}</option>
                <option value="en">{t('settings.langEn')}</option>
              </select>
            </label>
          </div>

          {/* Push notifications section */}
          {loading ? (
            <div className="flex items-center justify-center py-6 text-zinc-400">
              <Loader2 size={24} className="animate-spin" />
            </div>
          ) : !serverEnabled ? (
            <p className="py-2 text-center text-sm text-zinc-500">
              {t('settings.pushNotConfigured')}
            </p>
          ) : (
            <>
              {showIosHint && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                  {t('settings.iosHint')}
                </div>
              )}

              <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    {t('settings.notificationsOnDevice')}
                  </span>
                  <input
                    type="checkbox"
                    checked={subscribed}
                    disabled={subscribing}
                    onChange={onToggleSubscription}
                    className="rounded border-zinc-300 text-sky-500 focus:ring-sky-500 size-4"
                  />
                </label>
              </div>

              <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800 space-y-3">
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    {t('settings.dailyDigest')}
                  </span>
                  <input
                    type="checkbox"
                    checked={digestEnabled}
                    onChange={(e) => void onToggleDigest(e.target.checked)}
                    className="rounded border-zinc-300 text-sky-500 focus:ring-sky-500 size-4"
                  />
                </label>

                <div className="flex items-center justify-between pt-1 border-t border-zinc-100 dark:border-zinc-800/60">
                  <span className="text-sm text-zinc-600 dark:text-zinc-400">{t('settings.digestTimeLabel')}</span>
                  <input
                    type="time"
                    value={digestTime}
                    onChange={(e) => void onChangeDigestTime(e.target.value)}
                    className="rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700"
                  />
                </div>
              </div>

              <button
                type="button"
                disabled={!subscribed || testing}
                onClick={onSendTest}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                {testing ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                <span>{t('settings.sendTest')}</span>
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
