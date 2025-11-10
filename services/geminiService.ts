import { FunctionDeclaration, Type } from '@google/genai';

export const addRunsFunction: FunctionDeclaration = {
  name: 'addRuns',
  description: 'Records runs scored by the batsman. Can be used for a new delivery or to edit a previous one in the current over.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      runs: {
        type: Type.INTEGER,
        description: 'The number of runs scored. Must be between 0 and 6.',
      },
      ballNumber: {
        type: Type.INTEGER,
        description: 'Optional. The ball number within the over (1-6) to edit. If not provided, it records a new delivery.',
      }
    },
    required: ['runs'],
  },
};

export const declareWicketFunction: FunctionDeclaration = {
  name: 'declareWicket',
  description: 'Records a wicket. Can be used for a new delivery or to edit a previous one in the current over.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      runsOnDismissal: {
        type: Type.INTEGER,
        description: 'Runs scored on the ball the wicket fell, e.g., for a run out. Defaults to 0. Must be between 0 and 6.',
      },
      ballNumber: {
        type: Type.INTEGER,
        description: 'Optional. The ball number within the over (1-6) to edit. If not provided, it records a new delivery.',
      }
    },
    required: ['runsOnDismissal'],
  },
};

export const declareExtraFunction: FunctionDeclaration = {
    name: 'declareExtra',
    description: 'Records an extra. Can be used for a new delivery or to edit a previous one in the current over.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            type: {
                type: Type.STRING,
                enum: ['wide', 'no_ball'],
                description: 'The type of extra, either "wide" or "no_ball".',
            },
            runs: {
                type: Type.INTEGER,
                description: 'Additional runs scored from the extra delivery, not including the penalty run. E.g., for a wide that goes to the boundary, runs would be 4. Must be between 0 and 6.',
            },
            ballNumber: {
                type: Type.INTEGER,
                description: 'Optional. The ball number within the over (1-6) to edit. If not provided, it records a new delivery.',
            }
        },
        required: ['type', 'runs']
    }
};

export const clearLastBallFunction: FunctionDeclaration = {
    name: 'clearLastBall',
    description: 'Removes the last recorded delivery from the over and corrects the score.',
    parameters: {
        type: Type.OBJECT,
        properties: {},
    }
};

export const toolDeclarations: FunctionDeclaration[] = [
    addRunsFunction,
    declareWicketFunction,
    declareExtraFunction,
    clearLastBallFunction
];