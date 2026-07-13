import wordsKoRaw from './words-ko.json';
import wordsEnRaw from './words-en.json';

/**
 * 시스템에 설치된 오픈소스 사전에서 2글자 이상 단어를 전부 추출해 만든 목록.
 * - 한국어: hunspell-ko(spellcheck-ko 프로젝트, MPL-1.1/GPL-2+/LGPL-2.1+)의
 *   `/usr/share/hunspell/ko.dic`에서 순수 한글 음절 2~7자 단어를 추출(원본이
 *   자모 분해형(NFD)으로 저장돼 있어 NFC로 정규화 후 필터링).
 * - 영어: wamerican(SCOWL, Kevin Atkinson) 패키지의 `/usr/share/dict/words`에서
 *   소문자 2~10자 알파벳 단어만 추출(고유명사·특수문자 제외).
 * 추출·근거는 docs/typing-survival-implementation-notes-2026-07-13.md 참고.
 */
export const WORDS_KO: string[] = wordsKoRaw;
export const WORDS_EN: string[] = wordsEnRaw;
