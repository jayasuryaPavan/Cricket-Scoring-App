
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveSession, LiveServerMessage, Modality } from '@google/genai';
import { ScoreState, BallEvent } from './types';
import { createBlob, decode, decodeAudioData } from './utils/audioUtils';
import { toolDeclarations } from './services/geminiService';
import { MicrophoneIcon, PowerIcon } from './components/Icons';

const INITIAL_SCORE_STATE: ScoreState = {
  runs: 0,
  wickets: 0,
  overs: 0,
  balls: 0,
  recentThisOver: [],
  inningsOver: false,
  targetOvers: 20,
  maxWickets: 10,
};

const App: React.FC = () => {
  const [score, setScore] = useState<ScoreState>(() => {
    try {
      const savedScore = sessionStorage.getItem('cricketScore');
      return savedScore ? JSON.parse(savedScore) : INITIAL_SCORE_STATE;
    } catch (error) {
      console.error("Could not parse saved score:", error);
      return INITIAL_SCORE_STATE;
    }
  });
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'listening' | 'error'>('idle');
  
  const sessionPromiseRef = useRef<Promise<LiveSession> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const outputGainNodeRef = useRef<GainNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  useEffect(() => {
    sessionStorage.setItem('cricketScore', JSON.stringify(score));
  }, [score]);

  const handleMaxWicketsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newMaxWickets = parseInt(e.target.value, 10);
    if (!isNaN(newMaxWickets) && newMaxWickets > 0) {
        setScore(prevScore => ({
            ...prevScore,
            maxWickets: newMaxWickets
        }));
    }
  };

  const recordDelivery = useCallback((type: string, args: any, ballNumberToEdit?: number) => {
    setScore(currentScore => {
        if (currentScore.inningsOver) return currentScore;

        let newScore = { ...currentScore };
        let newRecentThisOver = [...newScore.recentThisOver];

        // Step 1: If it's an edit, revert the original ball's score.
        if (ballNumberToEdit && ballNumberToEdit > 0 && ballNumberToEdit <= newRecentThisOver.length) {
            const originalBallIndex = ballNumberToEdit - 1;
            const originalBall = newRecentThisOver[originalBallIndex];

            newScore.runs -= originalBall.runs;
            if (originalBall.isWicket) {
                newScore.wickets -= 1;
            }
        }

        // Step 2: Create the new BallEvent object from the function call.
        const newBallEvent: BallEvent = {
            display: '',
            runs: 0,
            isWicket: false,
            isLegalDelivery: false,
        };

        switch (type) {
            case 'addRuns':
                newBallEvent.runs = args.runs as number;
                newBallEvent.display = args.runs.toString();
                newBallEvent.isLegalDelivery = true;
                break;
            case 'declareWicket':
                const runsOnDismissal = (args.runsOnDismissal || 0) as number;
                newBallEvent.runs = runsOnDismissal;
                newBallEvent.isWicket = true;
                newBallEvent.display = 'W' + (runsOnDismissal > 0 ? `+${runsOnDismissal}` : '');
                newBallEvent.isLegalDelivery = true;
                break;
            case 'declareExtra':
                const extraType = args.type as 'wide' | 'no_ball';
                const extraRuns = args.runs as number;
                newBallEvent.runs = 1 + extraRuns; // 1 for penalty
                newBallEvent.display = `${extraRuns > 0 ? extraRuns : ''}${extraType === 'wide' ? 'wd' : 'nb'}`;
                newBallEvent.isLegalDelivery = false;
                newBallEvent.extraType = extraType;
                break;
        }

        // Step 3: Apply new ball's score.
        newScore.runs += newBallEvent.runs;
        if (newBallEvent.isWicket) {
            newScore.wickets += 1;
        }

        // Step 4: Update the recentThisOver array.
        if (ballNumberToEdit && ballNumberToEdit > 0 && ballNumberToEdit <= newRecentThisOver.length) {
            newRecentThisOver[ballNumberToEdit - 1] = newBallEvent;
        } else if (newRecentThisOver.filter(b => b.isLegalDelivery).length < 6) {
            newRecentThisOver.push(newBallEvent);
        }
        newScore.recentThisOver = newRecentThisOver;
        
        // Step 5: Recalculate overs and balls.
        const legalDeliveries = newScore.recentThisOver.filter(b => b.isLegalDelivery).length;
        if (legalDeliveries >= 6) {
            newScore.overs += 1;
            newScore.balls = 0;
            newScore.recentThisOver = [];
        } else {
            newScore.balls = legalDeliveries;
        }

        // Step 6: Check for innings end.
        if (newScore.wickets >= newScore.maxWickets || newScore.overs >= newScore.targetOvers) {
            newScore.inningsOver = true;
        }
        
        return newScore;
    });
  }, []);
  
  const clearLastDelivery = useCallback(() => {
    setScore(currentScore => {
        if (currentScore.inningsOver || currentScore.recentThisOver.length === 0) {
            return currentScore;
        }
        
        let newScore = { ...currentScore };
        let newRecentThisOver = [...newScore.recentThisOver];

        const lastBall = newRecentThisOver.pop()!;

        // Revert score
        newScore.runs -= lastBall.runs;
        if (lastBall.isWicket) {
            newScore.wickets -= 1;
        }

        newScore.recentThisOver = newRecentThisOver;
        newScore.balls = newScore.recentThisOver.filter(b => b.isLegalDelivery).length;

        return newScore;
    });
  }, []);

  const handleGeminiFunctionCall = useCallback((type: string, args: any) => {
    if (type === 'clearLastBall') {
        clearLastDelivery();
    } else {
        const ballNumber = args.ballNumber as number | undefined;
        recordDelivery(type, args, ballNumber);
    }
  }, [recordDelivery, clearLastDelivery]);

  const startSession = async () => {
    setStatus('connecting');
    setIsRecording(true);
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      outputGainNodeRef.current = outputAudioContextRef.current.createGain();
      outputGainNodeRef.current.connect(outputAudioContextRef.current.destination);
      
      const source = audioContextRef.current.createMediaStreamSource(stream);
      scriptProcessorRef.current = audioContextRef.current.createScriptProcessor(4096, 1, 1);
      
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

      const systemInstruction = `You are a cricket scoring assistant. Your primary role is to interpret the user's speech for scoring and call the appropriate functions.
The user will dictate commands. A command MUST provide context beyond just a number.

- A command can be for a specific ball, e.g., "1st ball 4 runs", "edit ball 3, wicket". You MUST extract the ball number and use the 'ballNumber' parameter.
- A command can be for the next delivery, e.g., "four runs", "wicket", "no ball". In this case, you should OMIT the 'ballNumber' parameter.
- CRITICAL RULE: You MUST ignore any utterance that is ONLY a number, for example "4" or "six". For runs to be counted, the user must explicitly say "runs" or provide context like a ball number (e.g., "1st ball 4"). An isolated number is not a valid command.
- Examples:
    - "1st ball 1" -> This is valid because '1st ball' provides context. Call addRuns({runs: 1, ballNumber: 1}).
    - "four runs" -> This is valid. Call addRuns({runs: 4}).
    - "4" -> INVALID. IGNORE.
    - "wicket" -> This is valid. Call declareWicket({runsOnDismissal: 0}).
    - "edit 2nd ball, wicket" -> This is valid. Call declareWicket({runsOnDismissal: 0, ballNumber: 2}).
    - "clear last ball" -> This is valid. Call clearLastBall().
`;

      sessionPromiseRef.current = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          systemInstruction,
          responseModalities: [Modality.AUDIO],
          tools: [{ functionDeclarations: toolDeclarations }],
        },
        callbacks: {
          onopen: () => {
            setStatus('listening');
            scriptProcessorRef.current!.onaudioprocess = (audioProcessingEvent) => {
              const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
              const pcmBlob = createBlob(inputData);
              sessionPromiseRef.current?.then((session) => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };
            source.connect(scriptProcessorRef.current);
            scriptProcessorRef.current.connect(audioContextRef.current.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.toolCall) {
              for (const fc of message.toolCall.functionCalls) {
                handleGeminiFunctionCall(fc.name, fc.args);
                sessionPromiseRef.current?.then((session) => {
                  session.sendToolResponse({
                    functionResponses: {
                      id: fc.id,
                      name: fc.name,
                      response: { result: "ok" },
                    }
                  });
                });
              }
            }
            const base64EncodedAudioString =
              message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;

            if (base64EncodedAudioString && outputAudioContextRef.current && outputGainNodeRef.current) {
              const outputAudioContext = outputAudioContextRef.current;
              nextStartTimeRef.current = Math.max(
                nextStartTimeRef.current,
                outputAudioContext.currentTime,
              );
              const audioBuffer = await decodeAudioData(
                decode(base64EncodedAudioString),
                outputAudioContext,
                24000,
                1,
              );
              const source = outputAudioContext.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(outputGainNodeRef.current);
              source.addEventListener('ended', () => {
                audioSourcesRef.current.delete(source);
              });

              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current = nextStartTimeRef.current + audioBuffer.duration;
              audioSourcesRef.current.add(source);
            }

            const interrupted = message.serverContent?.interrupted;
            if (interrupted) {
                for (const sourceNode of audioSourcesRef.current.values()) {
                    sourceNode.stop();
                    audioSourcesRef.current.delete(sourceNode);
                }
                nextStartTimeRef.current = 0;
            }
          },
          onerror: (e: ErrorEvent) => {
            console.error('Session error:', e);
            setStatus('error');
            stopSession();
          },
          onclose: () => {
            console.log('Session closed');
          },
        },
      });

    } catch (error) {
      console.error("Failed to start session:", error);
      setStatus('error');
      setIsRecording(false);
    }
  };

  const stopSession = () => {
    setIsRecording(false);
    setStatus('idle');

    sessionPromiseRef.current?.then(session => session.close());
    sessionPromiseRef.current = null;
    
    mediaStreamRef.current?.getTracks().forEach(track => track.stop());
    mediaStreamRef.current = null;
    
    scriptProcessorRef.current?.disconnect();
    scriptProcessorRef.current = null;
    
    audioContextRef.current?.close().catch(console.error);
    audioContextRef.current = null;

    audioSourcesRef.current.forEach(source => source.stop());
    audioSourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    
    outputGainNodeRef.current?.disconnect();
    outputGainNodeRef.current = null;
    
    outputAudioContextRef.current?.close().catch(console.error);
    outputAudioContextRef.current = null;
  };

  const handleToggleRecording = () => {
    if (isRecording) {
      stopSession();
    } else {
      startSession();
    }
  };

  const resetInnings = () => {
    const currentMaxWickets = score.maxWickets;
    setScore({
      ...INITIAL_SCORE_STATE,
      maxWickets: currentMaxWickets,
    });
  };
  
  const getStatusText = () => {
      switch(status) {
          case 'idle': return 'Tap to start scoring';
          case 'connecting': return 'Connecting...';
          case 'listening': return 'Listening... (e.g., "1st ball 4", "wicket", "clear last ball")';
          case 'error': return 'An error occurred. Please try again.';
          default: return '';
      }
  }
  
  const isGameStarted = score.runs > 0 || score.wickets > 0 || score.overs > 0 || score.balls > 0;

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center p-4 font-sans">
      <div className="w-full max-w-md bg-gray-800 rounded-2xl shadow-2xl p-6 relative overflow-hidden">
        {score.inningsOver && (
            <div className="absolute inset-0 bg-black bg-opacity-70 flex flex-col justify-center items-center z-10">
                <h2 className="text-4xl font-bold mb-4">Innings Over</h2>
                <button 
                    onClick={resetInnings}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded-lg transition-colors"
                >
                    New Innings
                </button>
            </div>
        )}
        <header className="text-center mb-6">
          <h1 className="text-3xl font-bold text-cyan-400">AI Cricket Scorer</h1>
        </header>

        <main className="text-center">
          <div className="mb-6">
              <label htmlFor="max-wickets" className="block text-sm font-medium text-gray-400">Max Wickets</label>
              <input
                  id="max-wickets"
                  type="number"
                  value={score.maxWickets}
                  onChange={handleMaxWicketsChange}
                  disabled={isGameStarted}
                  className="mt-1 mx-auto block w-24 rounded-md bg-gray-700 text-center text-white p-2 focus:ring-cyan-500 focus:border-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  min="1"
              />
          </div>

          <div className="flex justify-around items-center mb-6">
            <div className="score-display">
              <p className="text-7xl font-bold tracking-tighter">{score.runs}-{score.wickets}</p>
              <p className="text-gray-400">Runs - Wickets</p>
            </div>
            <div className="overs-display">
              <p className="text-4xl font-semibold">{score.overs}.{score.balls}</p>
              <p className="text-gray-400">Overs</p>
            </div>
          </div>

          <div className="this-over mb-6">
            <h3 className="text-lg font-semibold mb-2 text-gray-300">This Over</h3>
            <div className="flex justify-center space-x-2 h-10 items-center">
              {score.recentThisOver.length > 0 ? (
                score.recentThisOver.map((ball, index) => (
                  <span 
                    key={index} 
                    className="bg-gray-700 text-cyan-400 font-mono rounded-full w-10 h-10 flex items-center justify-center text-sm"
                  >
                    {ball.display}
                  </span>
                ))
              ) : (
                <p className="text-gray-500 italic">Waiting for first delivery...</p>
              )}
            </div>
          </div>

          <div className="mt-8 flex flex-col items-center">
            <button
              onClick={handleToggleRecording}
              className={`relative w-24 h-24 rounded-full flex items-center justify-center transition-all duration-300 ease-in-out
                ${isRecording ? 'bg-red-600 hover:bg-red-700' : 'bg-cyan-600 hover:bg-cyan-700'}
                focus:outline-none focus:ring-4 focus:ring-offset-2 focus:ring-offset-gray-800 ${isRecording ? 'focus:ring-red-500' : 'focus:ring-cyan-500'}
              `}
              aria-label={isRecording ? 'Stop scoring' : 'Start scoring'}
            >
              <div className={`absolute inset-0 rounded-full ${isRecording ? 'animate-pulse bg-red-500 opacity-75' : ''}`}></div>
              {isRecording ? <PowerIcon className="w-10 h-10 text-white" /> : <MicrophoneIcon className="w-10 h-10 text-white" />}
            </button>
            <p className="mt-4 text-sm text-gray-400 h-8">{getStatusText()}</p>
          </div>
        </main>
      </div>
    </div>
  );
};

export default App;
