export type RunnerAction = 'run' | 'jump' | 'slide' | 'fall';
export type RunnerSlidePhase = 'enter' | 'hold' | 'exit';

interface RunnerActionAsset {
  still: string;
  animation: string;
}

export interface RunnerCharacter {
  id: string;
  label: string;
  shortLabel: string;
  style: 'flat-sticker' | 'storybook-paper' | 'soft-3d-toy';
  identity: 'girl' | 'boy';
  preview: string;
  actions: Record<RunnerAction, RunnerActionAsset>;
  slideClips: Record<RunnerSlidePhase, string>;
}

const importedAssets = import.meta.glob(
  [
    '../../../endless-runner/assets/characters/pink-glasses-girl-soft-3d-toy/*.{png,gif}',
    '../../../endless-runner/assets/characters/checkered-vest-boy-soft-3d-toy/*.{png,gif}'
  ],
  { eager: true, query: '?url', import: 'default' }
) as Record<string, string>;

function assetUrl(characterId: string, name: string, extension: 'png' | 'gif'): string {
  const key = `../../../endless-runner/assets/characters/${characterId}/${characterId}-${name}.${extension}`;
  const url = importedAssets[key];
  if (!url) throw new Error(`Missing endless-runner character asset: ${key}`);
  return url;
}

function character(
  id: string,
  label: string,
  shortLabel: string,
  style: RunnerCharacter['style'],
  identity: RunnerCharacter['identity']
): RunnerCharacter {
  const actions = Object.fromEntries(
    (['run', 'jump', 'slide', 'fall'] as const).map((action) => [
      action,
      {
        still: assetUrl(id, action, 'png'),
        animation: assetUrl(id, action, 'gif')
      }
    ])
  ) as Record<RunnerAction, RunnerActionAsset>;
  const slideClips = Object.fromEntries(
    (['enter', 'hold', 'exit'] as const).map((phase) => [
      phase,
      assetUrl(id, `slide-${phase}`, 'gif')
    ])
  ) as Record<RunnerSlidePhase, string>;
  return { id, label, shortLabel, style, identity, preview: actions.run.still, actions, slideClips };
}

export const RUNNER_CHARACTERS: RunnerCharacter[] = [
  character('pink-glasses-girl-soft-3d-toy', '이엘이', '이엘이', 'soft-3d-toy', 'girl'),
  character('checkered-vest-boy-soft-3d-toy', '이안이', '이안이', 'soft-3d-toy', 'boy')
];

export const DEFAULT_RUNNER_CHARACTER_ID = RUNNER_CHARACTERS[0].id;

export function findRunnerCharacter(id: string): RunnerCharacter {
  const exactMatch = RUNNER_CHARACTERS.find((candidate) => candidate.id === id);
  if (exactMatch) return exactMatch;

  // 이전 화풍을 선택한 브라우저도 같은 아이의 고품질 소프트 3D 버전으로 자연스럽게 이관한다.
  if (id.startsWith('pink-glasses-girl-')) return RUNNER_CHARACTERS[0];
  if (id.startsWith('checkered-vest-boy-')) return RUNNER_CHARACTERS[1];
  return RUNNER_CHARACTERS[0];
}
