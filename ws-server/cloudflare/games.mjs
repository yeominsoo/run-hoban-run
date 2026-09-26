import { registerColorInstructionServer } from '../color-instruction.mjs';
import { registerGomokuServer } from '../gomoku.mjs';
import { registerHalliGalliServer } from '../halligalli.mjs';
import { registerLiarServer } from '../liar.mjs';
import { registerLightGuessServer } from '../light-guess.mjs';
import { registerMafiaServer } from '../mafia.mjs';
import { registerMemorySequenceServer } from '../memory-sequence.mjs';
import { registerMoleHuntServer } from '../mole-hunt.mjs';
import { registerMultiplicationSprintServer } from '../multiplication-sprint.mjs';
import { registerOddEvenMathServer } from '../odd-even-math.mjs';
import { registerReversiServer } from '../reversi.mjs';
import { registerRpsServer } from '../rps.mjs';
import { registerStrategyYutnoriServer } from '../strategy-yutnori.mjs';
import { registerSumTenPuzzleServer } from '../sum-ten-puzzle.mjs';
import { registerTerritoryClashServer } from '../territory-clash.mjs';
import { registerTugOfWarBattleServer } from '../tug-of-war-battle.mjs';
import { registerUpdownNumberServer } from '../updown-number.mjs';
import { registerYutnoriServer } from '../yutnori.mjs';

export const games = {
  'color-instruction': registerColorInstructionServer,
  'gomoku': registerGomokuServer,
  'halligalli': registerHalliGalliServer,
  'liar': registerLiarServer,
  'light-guess': registerLightGuessServer,
  'mafia': registerMafiaServer,
  'memory-sequence': registerMemorySequenceServer,
  'mole-hunt': registerMoleHuntServer,
  'multiplication-sprint': registerMultiplicationSprintServer,
  'odd-even-math': registerOddEvenMathServer,
  'reversi': registerReversiServer,
  'rps': registerRpsServer,
  'strategy-yutnori': registerStrategyYutnoriServer,
  'sum-ten-puzzle': registerSumTenPuzzleServer,
  'territory-clash': registerTerritoryClashServer,
  'tug-of-war-battle': registerTugOfWarBattleServer,
  'updown-number': registerUpdownNumberServer,
  'yutnori': registerYutnoriServer,
};

export const scoreGames = ['aim-trainer', 'color-slider', 'ball-dodge', 'tower-stack', 'snake', 'typing-survival', '2048-hex', 'endless-runner', 'idle-farm', 'sum-ten-puzzle'];
