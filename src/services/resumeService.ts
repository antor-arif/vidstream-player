import type { ResumeConfig } from '../types';

const DEFAULT_PREFIX = 'vp_resume_';

interface ResumeData {
  time: number;
  duration: number;
  savedAt: number;
}

function storageKey(src: string, prefix: string): string {
  // Use a short hash of the src to keep keys stable and safe
  let hash = 0;
  for (let i = 0; i < src.length; i++) {
    hash = (hash * 31 + src.charCodeAt(i)) >>> 0;
  }
  return prefix + hash.toString(36);
}

export function saveResume(src: string, time: number, duration: number, config: ResumeConfig): void {
  const minWatch = config.minWatchTime ?? 5;
  if (time < minWatch) return;
  try {
    const key = storageKey(src, config.storageKey ?? DEFAULT_PREFIX);
    const data: ResumeData = { time, duration, savedAt: Date.now() };
    localStorage.setItem(key, JSON.stringify(data));
  } catch {}
}

export function loadResume(src: string, config: ResumeConfig): ResumeData | null {
  try {
    const key = storageKey(src, config.storageKey ?? DEFAULT_PREFIX);
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as ResumeData) : null;
  } catch {
    return null;
  }
}

export function clearResume(src: string, config: ResumeConfig): void {
  try {
    const key = storageKey(src, config.storageKey ?? DEFAULT_PREFIX);
    localStorage.removeItem(key);
  } catch {}
}

// Prompt UI — returns a promise: true = resume, false = start over
export function showResumePrompt(container: HTMLElement, time: number): Promise<boolean> {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'vp-resume-prompt';

    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60).toString().padStart(2, '0');
    const label = mins > 0 ? `${mins}:${secs}` : `0:${secs}`;

    overlay.innerHTML = `
      <div class="vp-resume-box">
        <p class="vp-resume-text">Resume from <strong>${label}</strong>?</p>
        <div class="vp-resume-actions">
          <button class="vp-resume-btn vp-resume-yes" type="button">Resume</button>
          <button class="vp-resume-btn vp-resume-no" type="button">Start over</button>
        </div>
      </div>
    `;

    container.appendChild(overlay);

    const cleanup = (result: boolean) => {
      overlay.remove();
      resolve(result);
    };

    overlay.querySelector('.vp-resume-yes')!.addEventListener('click', () => cleanup(true));
    overlay.querySelector('.vp-resume-no')!.addEventListener('click', () => cleanup(false));
  });
}

export const resumePromptStyles = `
  .vp-resume-prompt {
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 70;
    background: rgba(0,0,0,0.5);
  }
  .vp-resume-box {
    background: rgba(24,24,27,0.97);
    border-radius: 10px;
    padding: 20px 28px;
    text-align: center;
    color: #fff;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  }
  .vp-resume-text {
    margin: 0 0 16px;
    font-size: 15px;
    line-height: 1.5;
  }
  .vp-resume-actions {
    display: flex;
    gap: 10px;
    justify-content: center;
  }
  .vp-resume-btn {
    padding: 8px 20px;
    border: none;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.15s;
  }
  .vp-resume-btn:hover { opacity: 0.85; }
  .vp-resume-yes {
    background: var(--vp-accent-color, #e50914);
    color: #fff;
  }
  .vp-resume-no {
    background: rgba(255,255,255,0.15);
    color: #fff;
  }
`;
