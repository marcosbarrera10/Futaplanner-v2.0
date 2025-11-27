import React, { useState, useEffect, useRef } from 'react';
import { MapPin, Navigation, Wind, Camera, Mountain, Footprints, Car, Bike, Bus, Sun, CloudRain, Send, Info, Calendar, ArrowRight, Settings, X, SendHorizontal, Compass, Trash2, CheckCircle, Ticket, Map } from 'lucide-react';
import { geminiService } from './services/geminiService';
import { getCurrentWeather } from './services/weatherService';
import { Message, Sender, WeatherData, Option, TransportType } from './types';

// --- UTILIDADES ---
const getDaysDiff = (start: string, end: string) => {
  const date1 = new Date(start);
  const date2 = new Date(end);
  const diffTime = Math.abs(date2.getTime() - date1.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
  return diffDays || 1; 
};

const isNearDate = (dateString: string) => {
  const today = new Date();
  const tripDate = new Date(dateString);
  const diffTime = tripDate.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays >= 0 && diffDays <= 5;
};

// Utility to ensure text is clean of Markdown artifacts
const cleanText = (text: string): string => {
    if (!text) return "";
    return text
        .replace(/\*\*/g, '')   // Remove bold **
        .replace(/\*/g, '')     // Remove single *
        .replace(/^#+\s*/gm, '') // Remove headers #
        .replace(/`/g, '');     // Remove code ticks
};

// --- COMPONENTE RENDERIZADOR DE LINKS ---
const LinkRenderer = ({ text }: { text: string }) => {
  // First clean the text of markdown artifacts
  const cleanedText = cleanText(text);

  // Regex para detectar links Markdown [texto](url) O urls sueltas https://...
  const regex = /\[([^\]]+)\]\((https?:\/\/[^\)]+)\)|(https?:\/\/[^\s\)]+)/g;
  
  const parts = [];
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(cleanedText)) !== null) {
    if (match.index > lastIndex) {
      parts.push(cleanedText.substring(lastIndex, match.index));
    }

    if (match[1] && match[2]) {
      // Markdown Link
      parts.push(
        <a 
          key={match.index} 
          href={match[2]} 
          target="_blank" 
          rel="noopener noreferrer" 
          className="text-emerald-600 underline hover:text-emerald-800 font-medium break-all"
        >
          {match[1]}
        </a>
      );
    } else if (match[3]) {
      // Raw URL
      parts.push(
        <a 
          key={match.index} 
          href={match[3]} 
          target="_blank" 
          rel="noopener noreferrer" 
          className="text-blue-500 underline hover:text-blue-700 break-all"
        >
          {match[3]}
        </a>
      );
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < cleanedText.length) {
    parts.push(cleanedText.substring(lastIndex));
  }

  return <>{parts.length > 0 ? parts : cleanedText}</>;
};

// --- PARSER DE GEMINI ---
// Convierte el texto estructurado de la IA en objetos para la UI
const parseGeminiResponse = (text: string, typeContext: 'welcome' | 'detail' | 'general'): Partial<Message> => {
  try {
    // CASE 1: WELCOME PHASE (Cards)
    if (typeContext === 'welcome' || (text.includes('Opción A:') && text.includes('Vibe:'))) {
      const lines = text.split('\n');
      let introText = "";
      const options: Option[] = [];
      
      // Extract Intro
      const optionAIndex = lines.findIndex(line => line.includes('Opción A:'));
      if (optionAIndex !== -1) {
        introText = lines.slice(0, optionAIndex).join(' ').replace(/Soy FutaPlanner.*?(\.|$)/i, '').trim();
      } else {
        introText = text;
      }

      // Extract Options using Regex for robustness
      const extractOption = (id: string) => {
         const regex = new RegExp(`Opción ${id}:\\s*(.*?)(\\n|$)`, 'i');
         const match = text.match(regex);
         if (match) {
            let rawTitle = match[1].trim(); 
            let emoji = "✨"; // Default fallback
            let title = rawTitle;

            // Attempt to extract emoji from start of string (Unicode emoji range approximation or exact regex)
            // Using regex to find emojis at the start
            const emojiMatch = rawTitle.match(/^([\p{Emoji}\p{Extended_Pictographic}]+)/u);
            if (emojiMatch) {
                emoji = emojiMatch[0];
                title = rawTitle.replace(emoji, '').trim();
            }
            
            // Find properties nearby the option title
            const blockStart = text.indexOf(match[0]);
            const blockText = text.slice(blockStart);
            
            const whatMatch = blockText.match(/¿Qué es\?:(.*?)(?=\n|$)/i);
            const vibeMatch = blockText.match(/Vibe:(.*?)(?=\n|$)/i);
            const timeMatch = blockText.match(/Tiempo:(.*?)(?=\n|$)/i);

            const cleanedTitle = cleanText(title).trim();
            const desc = cleanText(whatMatch ? whatMatch[1].trim() : "Descripción no disponible");

            return {
                id,
                title: cleanedTitle,
                emoji,
                desc: desc,
                vibe: cleanText(vibeMatch ? vibeMatch[1].trim() : "General"),
                time: cleanText(timeMatch ? timeMatch[1].trim() : "-")
            };
         }
         return null;
      };

      const optA = extractOption('A');
      const optB = extractOption('B'); 

      if (optA) options.push(optA);
      if (optB) options.push(optB);

      if (options.length > 0) {
        return {
            type: 'welcome_phase',
            content: "Soy FutaPlanner, estoy para ayudarte en tu viaje a Futaleufú.",
            subContent: cleanText(introText || "Aquí tienes algunas opciones para tu viaje:"),
            options: options
        };
      }
    } 
    
    // CASE 2: DETAIL PHASE
    if (typeContext === 'detail' || text.includes('📍 Destino:')) {
        const titleMatch = text.match(/📍 Destino:(.*?)(?=\n|$)/i);
        const howMatch = text.match(/Cómo ir:(.*?)(?=\nEl Mapa|Lo imperdible|⚠️|$)/is); // Multiline
        const highlightMatch = text.match(/Lo imperdible:(.*?)(?=\n|⚠️|$)/i);
        const warningMatch = text.match(/⚠️ Ojo:(.*?)(?=\n|$)/i);

        // Parse steps from "Cómo ir" or just use the text
        let steps: string[] = [];
        if (howMatch) {
            // Split by periods or newlines to make steps
            steps = howMatch[1].trim().split(/\. (?=[A-Z])|\n/).map(s => cleanText(s.trim())).filter(s => s.length > 5);
        }
        
        const rawTitle = titleMatch ? titleMatch[1].trim() : "Detalle";
        
        return {
            type: 'detail_phase',
            title: cleanText(rawTitle),
            steps: steps.length > 0 ? steps : ["Sigue las instrucciones del mapa."],
            highlight: cleanText(highlightMatch ? highlightMatch[1].trim() : ""),
            warning: cleanText(warningMatch ? warningMatch[1].trim() : ""),
            content: text // Keep full text as fallback
        };
    }

    // CASE 3: GENERAL CHAT
    return { type: 'text', content: cleanText(text) };

  } catch (e) {
    console.error("Error parsing Gemini response", e);
    return { type: 'text', content: cleanText(text) };
  }
};


// --- COMPONENTE PRINCIPAL ---
export default function FutaPlannerApp() {
  // Estados de Configuración
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(new Date(Date.now() + 86400000 * 2).toISOString().split('T')[0]);
  const [transport, setTransport] = useState<'foot'|'auto'|'bike'|'bus'>('auto');
  const [vibe, setVibe] = useState<'aventura'|'relax'|'vistas'>('relax');
  
  // Estados de UI (With Persistence)
  const [viewMode, setViewMode] = useState<'landing' | 'chat'>('landing');
  const [chatHistory, setChatHistory] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [chatState, setChatState] = useState<'idle' | 'showing_options' | 'processing_choice' | 'showing_details'>('idle');
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  
  // Estados de Planificación
  const [currentPlanDay, setCurrentPlanDay] = useState(1);
  const [itinerary, setItinerary] = useState<{day: number, title: string, emoji?: string}[]>([]);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [initialized, setInitialized] = useState(false);

  // --- EFECTOS (Persistencia) ---
  useEffect(() => {
    // Load from local storage
    const savedHistory = localStorage.getItem('futa_chatHistory');
    const savedState = localStorage.getItem('futa_chatState');
    const savedDay = localStorage.getItem('futa_currentPlanDay');
    const savedView = localStorage.getItem('futa_viewMode');
    const savedItinerary = localStorage.getItem('futa_itinerary');
    
    if (savedHistory) setChatHistory(JSON.parse(savedHistory));
    if (savedState) setChatState(savedState as any);
    if (savedDay) setCurrentPlanDay(parseInt(savedDay));
    if (savedItinerary) setItinerary(JSON.parse(savedItinerary));
    if (savedView && JSON.parse(savedHistory)?.length > 0) setViewMode(savedView as any); 
    
    setInitialized(true);
  }, []);

  useEffect(() => {
      if (!initialized) return;
      localStorage.setItem('futa_chatHistory', JSON.stringify(chatHistory));
      localStorage.setItem('futa_chatState', chatState);
      localStorage.setItem('futa_currentPlanDay', currentPlanDay.toString());
      localStorage.setItem('futa_viewMode', viewMode);
      localStorage.setItem('futa_itinerary', JSON.stringify(itinerary));
  }, [chatHistory, chatState, currentPlanDay, viewMode, itinerary, initialized]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [chatHistory, isTyping, viewMode, chatState]);

  useEffect(() => {
    const loadWeather = async () => {
      const data = await getCurrentWeather();
      setWeather(data);
    };
    loadWeather();
  }, []);

  // --- RESET/CLEAR ---
  const handleClearHistory = () => {
    if(window.confirm('¿Estás seguro de querer borrar tu itinerario?')) {
        setChatHistory([]);
        setChatState('idle');
        setCurrentPlanDay(1);
        setItinerary([]);
        setViewMode('landing');
        geminiService.reset();
        localStorage.removeItem('futa_chatHistory');
        localStorage.removeItem('futa_chatState');
        localStorage.removeItem('futa_currentPlanDay');
        localStorage.removeItem('futa_itinerary');
    }
  };

  // --- LÓGICA DEL PLAN (WIZARD) ---
  const handleStartPlan = async () => {
    setViewMode('chat');
    setMobileMenuOpen(false);
    
    // Start fresh
    setChatHistory([]);
    setChatState('idle');
    setCurrentPlanDay(1); 
    setItinerary([]);
    geminiService.reset();
    
    setIsTyping(true);
    
    const totalDays = getDaysDiff(startDate, endDate);
    const isNear = isNearDate(startDate);
    
    // Contexto real para la IA
    let weatherContext = "";
    if (isNear && weather) {
      weatherContext = `El usuario viaja PRONTO (${startDate}). Clima Real Actual: ${weather.temp}°C, ${weather.condition}, ${weather.description}. Ajusta sugerencias a esto.`;
    } else {
      weatherContext = `El usuario viaja en el FUTURO (${startDate}). Planifica basándote en clima histórico promedio para esa fecha.`;
    }

    const prompt = `
    [NUEVA SESIÓN DE PLANIFICACIÓN]
    Días de estadía: ${totalDays}
    Transporte: ${transport}
    Vibe: ${vibe}
    Contexto Temporal: ${weatherContext}
    
    RAZONAMIENTO TEMPORAL: El usuario va a estar ${totalDays} días.
    ESTRATEGIA: Estás planificando el DÍA 1 de ${totalDays}.
    
    Inicia el protocolo de bienvenida (Fase 1) proponiendo 2 opciones ideales para comenzar el viaje (Día 1). 
    Recuerda el formato estricto de Tarjetas (Opción A / Opción B).
    `;

    try {
      const { text, sources } = await geminiService.sendMessage(prompt);
      const parsedMsg = parseGeminiResponse(text, 'welcome');
      
      const welcomeMsg: Message = {
        id: Date.now().toString(),
        sender: Sender.AI,
        timestamp: new Date(),
        content: text, // Fallback
        sources: sources,
        ...parsedMsg
      };

      setChatHistory([welcomeMsg]);
      setChatState('showing_options');

    } catch (e) {
      console.error(e);
      setChatHistory([{
        id: Date.now().toString(),
        sender: Sender.AI,
        timestamp: new Date(),
        content: "Tuve un problema al conectar con los servicios. Por favor intenta de nuevo.",
        type: 'text'
      }]);
    } finally {
        setIsTyping(false);
    }
  };

  const handleOptionSelect = async (option: Option) => {
    // Record selection for the itinerary summary
    setItinerary(prev => [
        ...prev, 
        { day: currentPlanDay, title: option.title, emoji: option.emoji }
    ]);

    const userMsg: Message = {
      id: Date.now().toString(),
      sender: Sender.User,
      content: `Me tinca la Opción ${option.id}: ${option.title}`,
      timestamp: new Date()
    };
    setChatHistory(prev => [...prev, userMsg]);
    setChatState('processing_choice');
    setIsTyping(true);

    try {
        // Send selection to AI
        const prompt = `El usuario eligió para el DÍA ${currentPlanDay}: Opción ${option.id} (${option.title}). Entrega el DETALLE (Fase 2) ahora. Recuerda el formato estricto (📍 Destino, Cómo ir, etc).`;
        const { text, sources } = await geminiService.sendMessage(prompt);
        
        const parsedMsg = parseGeminiResponse(text, 'detail');
        
        const detailMsg: Message = {
            id: (Date.now()+1).toString(),
            sender: Sender.AI,
            timestamp: new Date(),
            content: text,
            sources: sources,
            ...parsedMsg
        };
        
        setChatHistory(prev => [...prev, detailMsg]);
        setChatState('showing_details');

    } catch (e) {
        console.error(e);
    } finally {
        setIsTyping(false);
    }
  };

  const handleOtherPanoramas = async () => {
    const userMsg: Message = {
      id: Date.now().toString(),
      sender: Sender.User,
      content: "Quiero ver otros panoramas diferentes",
      timestamp: new Date(),
      type: 'text'
    };
    setChatHistory(prev => [...prev, userMsg]);
    setChatState('processing_choice');
    setIsTyping(true);

    try {
        const prompt = `
        [SOLICITUD: VER OTROS PANORAMAS PARA EL DÍA ${currentPlanDay}]
        El usuario quiere ver OPCIONES DIFERENTES a las anteriores para este mismo día.
        
        TU OBJETIVO: Olvida las sugerencias previas (ej: si ya dijiste Piedra del Águila, busca otra cosa).
        Consulta tu Base de Conocimientos completa (PDF Rutas) y busca atractivos en sectores alternativos.
        
        Genera 2 NUEVAS opciones (Opción A y Opción B) usando el MISMO formato de tarjetas estricto.
        `;
        
        const { text, sources } = await geminiService.sendMessage(prompt);
        const parsedMsg = parseGeminiResponse(text, 'welcome');
        
        const newOptionsMsg: Message = {
            id: (Date.now()+1).toString(),
            sender: Sender.AI,
            timestamp: new Date(),
            content: text,
            sources: sources,
            ...parsedMsg
        };
        
        setChatHistory(prev => [...prev, newOptionsMsg]);
        setChatState('showing_options');

    } catch (e) {
        console.error(e);
    } finally {
        setIsTyping(false);
    }
  };

  const handleNextDay = async () => {
     const nextDay = currentPlanDay + 1;
     const totalDays = getDaysDiff(startDate, endDate);
     
     // Update logical state
     setCurrentPlanDay(nextDay);

     const userMsg: Message = {
      id: Date.now().toString(),
      sender: Sender.User,
      content: `Planifiquemos el Día ${nextDay}`,
      timestamp: new Date(),
      type: 'text'
    };
    setChatHistory(prev => [...prev, userMsg]);
    setChatState('processing_choice');
    setIsTyping(true);

    try {
        let prompt = "";
        
        if (nextDay > totalDays) {
             prompt = `
             [FIN DEL ITINERARIO PRINCIPAL]
             El usuario ha completado los ${totalDays} días originales.
             El usuario pide un "Día ${nextDay}" (Día Extra).
             
             Propón 2 opciones "Bonus" o actividades que quizás quedaron fuera (ej: Rafting, Visita a Argentina, Playas lejanas).
             Mantén el formato de Tarjetas (Opción A / Opción B).
             `;
        } else {
             prompt = `
            [PLANIFICACIÓN DÍA ${nextDay} DE ${totalDays}]
            Hemos terminado el Día ${currentPlanDay}.
            Ahora genera 2 opciones (Opción A y B) para el DÍA ${nextDay}.
            
            ESTRATEGIA:
            1. Considera lo que ya hicimos el Día ${currentPlanDay} (no repetir lo mismo).
            2. Si el día anterior fue trekking intenso, sugiere algo más relajado (agua/playa/auto).
            3. Si estamos en mitad del viaje, sugiere las actividades "Imperdibles" que falten.
            
            Usa el formato estricto de Tarjetas.
            `;
        }

        const { text, sources } = await geminiService.sendMessage(prompt);
        const parsedMsg = parseGeminiResponse(text, 'welcome');
        
        const newDayMsg: Message = {
            id: (Date.now()+1).toString(),
            sender: Sender.AI,
            timestamp: new Date(),
            content: text,
            sources: sources,
            ...parsedMsg
        };
        
        setChatHistory(prev => [...prev, newDayMsg]);
        setChatState('showing_options');
    } catch (e) {
        console.error(e);
    } finally {
        setIsTyping(false);
    }
  };

  const handleFinalizeItinerary = async () => {
    const userMsg: Message = {
      id: Date.now().toString(),
      sender: Sender.User,
      content: "✅ Listo, quiero finalizar mi itinerario.",
      timestamp: new Date(),
      type: 'text'
    };
    setChatHistory(prev => [...prev, userMsg]);
    setChatState('idle'); // Stop workflow
    setIsTyping(true);

    try {
        // We ask Gemini for a polite closing message, but we will construct the summary UI locally.
        const prompt = "El usuario ha decidido finalizar la planificación del itinerario. Despídete cordialmente, deséale un buen viaje a Futaleufú y recuérdale que puede seguir preguntando cosas específicas en el chat si lo necesita.";
        const { text, sources } = await geminiService.sendMessage(prompt);
        
        const aiMsg: Message = {
            id: (Date.now() + 1).toString(),
            sender: Sender.AI,
            timestamp: new Date(),
            content: text,
            sources: sources,
            type: 'summary_phase', // NEW TYPE
            itinerarySummary: itinerary // Attach the local itinerary data
        };
        
        setChatHistory(prev => [...prev, aiMsg]);
    } catch (e) {
        console.error(e);
    } finally {
        setIsTyping(false);
    }
  };

  // --- LÓGICA DE CHAT GENERAL ---
  const handleSendMessage = async () => {
    if (!inputValue.trim() || isTyping) return;
    
    const userText = inputValue;
    setInputValue(""); // Clear input immediately
    
    const userMsg: Message = {
        id: Date.now().toString(),
        sender: Sender.User,
        content: userText,
        timestamp: new Date(),
        type: 'text'
    };
    
    setChatHistory(prev => [...prev, userMsg]);
    setIsTyping(true);

    try {
        const { text, sources } = await geminiService.sendMessage(userText);
        // We treat manual inputs as 'general' unless the model forces a structure
        const parsedMsg = parseGeminiResponse(text, 'general');
        
        const aiMsg: Message = {
            id: (Date.now() + 1).toString(),
            sender: Sender.AI,
            timestamp: new Date(),
            content: text,
            sources: sources,
            ...parsedMsg
        };
        
        setChatHistory(prev => [...prev, aiMsg]);

    } catch (e) {
        console.error(e);
        setChatHistory(prev => [...prev, {
            id: Date.now().toString(),
            sender: Sender.AI,
            timestamp: new Date(),
            content: "Lo siento, tuve un problema al procesar tu mensaje.",
            type: 'text'
        }]);
    } finally {
        setIsTyping(false);
    }
  };

  const getTransportIcon = (type: TransportType) => {
      switch(type) {
          case 'auto': return <Car size={16} />;
          case 'bike': return <Bike size={16} />;
          case 'bus': return <Bus size={16} />;
          case 'foot': return <Footprints size={16} />;
          default: return <Car size={16} />;
      }
  }

  // --- COMPONENTES DE UI ---

  const ConfigForm = ({ isSidebar = false }: { isSidebar?: boolean }) => (
    <div className={`space-y-6 ${!isSidebar ? 'animate-fade-in' : ''}`}>
      
      {/* Fechas */}
      <div className="space-y-3">
        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
          <span className="w-1 h-4 bg-emerald-500 rounded-full"></span>
          Fechas del viaje
        </label>
        <div className={`grid ${isSidebar ? 'grid-cols-1 gap-3' : 'grid-cols-2 gap-4'}`}>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
              <Calendar size={14} />
            </div>
            <input 
              type="date" 
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="pl-9 pr-4 py-2.5 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 w-full focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none shadow-sm transition-all"
            />
          </div>
          <div className="relative">
             <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
              <ArrowRight size={14} />
            </div>
            <input 
              type="date" 
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="pl-9 pr-4 py-2.5 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 w-full focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none shadow-sm transition-all"
            />
          </div>
        </div>
        {!isSidebar && (
          <p className="text-xs text-slate-400 text-center mt-1">
            Duración calculada: <span className="font-bold text-emerald-600">{getDaysDiff(startDate, endDate)} días</span>
          </p>
        )}
      </div>

      {/* Transporte */}
      <div className="space-y-3">
        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
          <span className="w-1 h-4 bg-emerald-500 rounded-full"></span>
          Transporte
        </label>
        <div className={`grid ${isSidebar ? 'grid-cols-2' : 'grid-cols-4'} gap-2`}>
          {[
            { id: 'auto', label: 'Auto', icon: <Car size={16} /> },
            { id: 'foot', label: 'A Pie', icon: <Footprints size={16} /> },
            { id: 'bike', label: 'Bici', icon: <Bike size={16} /> },
            { id: 'bus', label: 'Bus', icon: <Bus size={16} /> },
          ].map((opt) => (
            <button
              key={opt.id}
              onClick={() => setTransport(opt.id as any)}
              className={`flex flex-col md:flex-row items-center gap-2 justify-center p-3 rounded-lg border text-sm transition-all ${
                transport === opt.id
                  ? 'bg-emerald-50 border-emerald-500 text-emerald-700 font-semibold shadow-sm ring-1 ring-emerald-500'
                  : 'bg-white border-slate-200 text-slate-500 hover:border-emerald-200 hover:bg-slate-50'
              }`}
            >
              {opt.icon} <span>{opt.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Vibe */}
      <div className="space-y-3">
        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
          <span className="w-1 h-4 bg-emerald-500 rounded-full"></span>
          Tu Vibe
        </label>
        <div className={`grid ${isSidebar ? 'grid-cols-1' : 'grid-cols-3'} gap-3`}>
          {[
            { id: 'aventura', label: 'Aventura', icon: <Wind size={18} /> },
            { id: 'relax', label: 'Relajo', icon: <Navigation size={18} /> },
            { id: 'vistas', label: 'Vistas', icon: <Camera size={18} /> },
          ].map((opt) => (
            <button
              key={opt.id}
              onClick={() => setVibe(opt.id as any)}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all ${
                vibe === opt.id
                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-md transform scale-[1.02]'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {opt.icon}
              <span className="font-medium">{opt.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Botón de Acción */}
      <button 
        onClick={handleStartPlan}
        className="w-full py-3.5 bg-slate-900 text-white rounded-xl font-bold text-lg shadow-lg hover:bg-slate-800 hover:shadow-xl transition-all flex items-center justify-center gap-2 active:scale-[0.98] group"
      >
        {isSidebar ? 'Reiniciar Plan' : '¡Armar mi Plan!'}
        <Send size={18} className="group-hover:translate-x-1 transition-transform" />
      </button>

      {/* Botón Borrar Historial (Solo Sidebar) */}
      {isSidebar && (
          <button 
            onClick={handleClearHistory}
            className="w-full py-2 mt-4 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            <Trash2 size={14} /> Borrar Historial
          </button>
      )}
    </div>
  );

  // --- RENDER PRINCIPAL ---
  return (
    <div className="flex h-screen bg-slate-50 font-sans text-slate-800 overflow-hidden">
      
      {/* VISTA 1: LANDING (Centrada) */}
      {viewMode === 'landing' && (
        <div className="w-full h-full overflow-y-auto bg-slate-50">
          <div className="min-h-full flex flex-col items-center justify-center p-4 py-8 md:py-12 animate-fade-in-up">
          
            {/* Card Central */}
            <div className="w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden flex flex-col">
              
              {/* Header Landing */}
              <div className="bg-emerald-850 p-8 text-center relative overflow-hidden">
                {/* Decoración */}
                <div className="absolute top-0 left-0 w-full h-full opacity-20 bg-gradient-to-br from-emerald-600 to-transparent"></div>
                <div className="absolute -right-10 -top-10 text-emerald-900 opacity-10 rotate-12">
                  <Mountain size={180} />
                </div>
                
                <div className="relative z-10 flex flex-col items-center">
                  <h1 className="text-3xl md:text-4xl font-bold text-white mb-2 font-serif tracking-tight">FutaPlanner</h1>
                  <p className="text-emerald-100 text-lg max-w-md mx-auto leading-relaxed">
                    Hola, estoy para ayudarte en tu viaje a Futaleufú.
                  </p>
                </div>
              </div>

              {/* Widget Clima Rápido */}
              <div className="bg-slate-50 border-b border-slate-100 px-6 py-3 flex items-center justify-center gap-3 text-sm text-slate-500">
                <span>Clima actual:</span>
                {weather ? (
                  <div className="flex items-center gap-1 font-bold text-slate-700">
                      <img src={`https://openweathermap.org/img/wn/${weather.icon}.png`} className="w-6 h-6" alt="icon" />
                      {weather.temp}°C {weather.condition}
                  </div>
                ) : (
                  <span className="animate-pulse bg-slate-200 w-20 h-4 rounded"></span>
                )}
              </div>

              {/* Body Landing */}
              <div className="p-6 md:p-10">
                <ConfigForm isSidebar={false} />
              </div>
            </div>
            
            <p className="mt-6 text-slate-400 text-sm font-medium pb-4">Powered by Gemini 3 • FutaPlanner AI</p>
          </div>
        </div>
      )}

      {/* VISTA 2: CHAT INTERFACE */}
      {viewMode === 'chat' && (
        <>
          {/* SIDEBAR (Desktop) */}
          <div className="w-80 bg-white border-r border-slate-200 flex flex-col h-full shadow-lg z-10 hidden md:flex flex-shrink-0 animate-fade-in-up">
            {/* Header Sidebar */}
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center text-white font-bold font-serif">F</div>
                <h1 className="text-xl font-bold text-slate-800 font-serif">FutaPlanner</h1>
              </div>
              <button className="text-slate-400 hover:text-emerald-600 transition-colors">
                 <Settings size={18} />
              </button>
            </div>
            
            {/* Config Form */}
            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
              <ConfigForm isSidebar={true} />
            </div>
          </div>

          {/* MOBILE MENU OVERLAY */}
          {mobileMenuOpen && (
            <div className="fixed inset-0 z-50 bg-black/50 md:hidden" onClick={() => setMobileMenuOpen(false)}>
                <div className="absolute left-0 top-0 h-full w-80 bg-white shadow-2xl p-6 overflow-y-auto" onClick={e => e.stopPropagation()}>
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="font-bold text-lg">Configuración</h2>
                        <button onClick={() => setMobileMenuOpen(false)}><X size={24} /></button>
                    </div>
                    <ConfigForm isSidebar={true} />
                </div>
            </div>
          )}

          {/* MAIN CHAT AREA */}
          <div className="flex-1 flex flex-col h-full relative bg-slate-50">
            
            {/* Mobile Header */}
            <div className="md:hidden bg-white p-4 border-b border-slate-200 flex items-center justify-between shadow-sm z-20">
               <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center text-white font-bold font-serif">F</div>
                <span className="font-bold text-slate-800 font-serif">FutaPlanner</span>
              </div>
              <button onClick={() => setMobileMenuOpen(true)} className="text-xs bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full font-bold flex items-center gap-1">
                <Settings size={14} /> Editar
              </button>
            </div>

            {/* Chat History */}
            <div className="flex-1 overflow-y-auto p-4 md:p-10 space-y-6 custom-scrollbar scroll-smooth">
              {chatHistory.map((msg, idx) => (
                <div key={idx} className={`flex ${msg.sender === Sender.User ? 'justify-end' : 'justify-start'} animate-fade-in-up`}>
                  
                  {msg.sender === Sender.AI && (
                     <div className="w-8 h-8 rounded-full bg-emerald-100 border border-emerald-200 flex items-center justify-center mr-3 flex-shrink-0 mt-1 shadow-sm">
                       <span className="text-emerald-700 text-xs font-bold font-serif">AI</span>
                     </div>
                  )}

                  <div className={`max-w-[95%] md:max-w-[80%] lg:max-w-[70%] ${
                    msg.sender === Sender.User 
                      ? 'bg-slate-800 text-white rounded-2xl rounded-tr-none px-5 py-3 shadow-sm' 
                      : 'bg-white border border-slate-100 rounded-2xl rounded-tl-none shadow-sm text-slate-700'
                  }`}>
                    
                    {/* RENDERIZADO CONDICIONAL SEGÚN TIPO */}
                    
                    {/* CASE 1: WELCOME / OPTIONS */}
                    {msg.type === 'welcome_phase' ? (
                      <div className="p-4 md:p-6 space-y-4">
                        <p className="text-lg font-medium text-emerald-800 border-l-4 border-emerald-500 pl-3 font-serif">
                          {cleanText(msg.content)}
                        </p>
                        <p className="text-slate-600 leading-relaxed text-sm">
                          <LinkRenderer text={msg.subContent || ""} />
                        </p>
                        
                        {msg.options && (
                            <>
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider pt-2">Te propongo estas opciones:</p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                            {msg.options.map((opt) => (
                                <button 
                                key={opt.id}
                                onClick={() => chatState === 'showing_options' && handleOptionSelect(opt)}
                                disabled={chatState !== 'showing_options'}
                                className={`text-left group relative overflow-hidden rounded-xl border-2 transition-all duration-300 flex flex-col ${
                                    chatState === 'showing_options' 
                                    ? 'border-slate-100 bg-white hover:border-emerald-400 hover:shadow-md cursor-pointer' 
                                    : 'border-slate-100 bg-slate-50 opacity-60 cursor-not-allowed'
                                }`}
                                >

                                <div className="p-5 pl-6 w-full">
                                    <div className="flex justify-between items-start mb-2">
                                        <span className="bg-emerald-100 text-emerald-700 text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wide">Opción {opt.id}</span>
                                        {opt.emoji && <span className="text-2xl">{opt.emoji}</span>}
                                    </div>
                                    <h3 className="font-bold text-slate-800 text-lg mb-1 group-hover:text-emerald-700 transition-colors font-serif">{opt.title}</h3>
                                    <p className="text-sm text-slate-500 leading-relaxed mb-4 min-h-[40px]">{opt.desc}</p>
                                    
                                    <div className="flex items-center gap-3 text-[10px] font-medium text-slate-400 border-t border-slate-100 pt-3">
                                    <div className="flex items-center gap-1">
                                        <Wind size={12} /> {opt.vibe}
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <Info size={12} /> {opt.time}
                                    </div>
                                    </div>
                                </div>
                                </button>
                            ))}
                            <button
                                onClick={() => chatState === 'showing_options' && handleOtherPanoramas()}
                                disabled={chatState !== 'showing_options'}
                                className={`md:col-span-2 flex items-center justify-center gap-2 p-4 rounded-xl border-2 border-dashed border-slate-300 text-slate-500 font-bold uppercase tracking-wide text-sm transition-all ${
                                    chatState === 'showing_options' 
                                    ? 'hover:border-emerald-500 hover:text-emerald-600 hover:bg-emerald-50 cursor-pointer' 
                                    : 'opacity-60 cursor-not-allowed'
                                }`}
                            >
                                <Compass size={18} />
                                Otros Panoramas
                            </button>
                            </div>
                            </>
                        )}
                        
                        {/* Persistent Footer Note (Enhanced) */}
                         <div className="mt-6 text-center">
                            <p className="text-sm md:text-base font-medium text-emerald-800 bg-emerald-50/80 py-3 px-4 rounded-xl border border-emerald-100">
                                💡 <strong>Recuerda:</strong> Si buscas algo específico, ¡pregúntame directamente en el chat!
                            </p>
                        </div>
                      </div>

                    /* CASE 2: DETAILS */
                    ) : msg.type === 'detail_phase' ? (
                      <div className="p-4 md:p-6 space-y-6">
                        {/* Header Detalles */}
                        <div>
                            <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                            <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600">
                                <MapPin size={20} />
                            </div>
                            <div>
                                <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Destino Seleccionado</p>
                                <h3 className="text-xl font-bold text-slate-800 font-serif">{msg.title}</h3>
                            </div>
                            </div>
                        </div>

                        {/* Pasos */}
                        <div className="space-y-4">
                          <h4 className="font-bold text-slate-700 flex items-center gap-2 text-sm">
                            <Navigation size={16} className="text-emerald-500" /> Cómo llegar:
                          </h4>
                          <ul className="space-y-3 pl-1">
                            {msg.steps?.map((step, i) => (
                              <li key={i} className="flex gap-3 text-slate-600 text-sm leading-relaxed">
                                <span className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-500 flex-shrink-0 border border-slate-200">{i+1}</span>
                                {step}
                              </li>
                            ))}
                          </ul>
                        </div>

                        {/* Botón Mapa */}
                        <a 
                            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(msg.title + " Futaleufu")}`} 
                            target="_blank"
                            rel="noopener noreferrer"
                            className="w-full py-3 px-4 bg-blue-50 border border-blue-100 text-blue-600 rounded-lg font-medium text-sm text-center hover:bg-blue-100 transition-colors flex items-center justify-center gap-2"
                        >
                          <MapPin size={16} /> Ver ubicación en Google Maps
                        </a>

                        {/* Cards Info Extra */}
                        <div className="grid grid-cols-1 gap-3">
                          {msg.highlight && (
                            <div className="bg-amber-50 border border-amber-100 rounded-lg p-3">
                                <p className="text-amber-800 text-sm font-medium flex items-start gap-2">
                                <span className="text-lg">✨</span> 
                                <span className="mt-0.5"><span className="font-bold">Lo imperdible:</span> {msg.highlight}</span>
                                </p>
                            </div>
                          )}
                          {msg.warning && (
                             <div className="bg-slate-100 border border-slate-200 rounded-lg p-3">
                                <p className="text-slate-600 text-sm font-medium flex items-start gap-2">
                                <span className="text-lg">⚠️</span> 
                                <span className="mt-0.5"><span className="font-bold">Ojo:</span> {msg.warning}</span>
                                </p>
                            </div>
                          )}
                        </div>

                        {/* Persistent Footer Note in Details */}
                        <div className="mt-4 text-center">
                            <p className="text-sm font-medium text-slate-500 bg-slate-50 py-2 px-3 rounded-lg border border-slate-100">
                                ¿Tienes dudas sobre este lugar? Pregúntame abajo 👇
                            </p>
                        </div>

                        {/* BUTTON FOR NEXT DAY PLAN (Multi-day trips) OR FINISH */}
                        {chatState === 'showing_details' && idx === chatHistory.length - 1 && (
                            <div className="pt-2">
                                <p className="text-xs text-center text-slate-400 mb-2">
                                    Día {Math.min(currentPlanDay, getDaysDiff(startDate, endDate))} de {getDaysDiff(startDate, endDate)}
                                </p>
                                
                                {currentPlanDay < getDaysDiff(startDate, endDate) ? (
                                    <button
                                        onClick={handleNextDay}
                                        className="w-full py-3 px-4 bg-emerald-600 text-white rounded-xl font-bold text-sm text-center hover:bg-emerald-700 transition-all flex items-center justify-center gap-2 shadow-sm animate-fade-in-up"
                                    >
                                        <Calendar size={16} />
                                        Planificar Día {currentPlanDay + 1}
                                    </button>
                                ) : (
                                    <button
                                        onClick={handleFinalizeItinerary}
                                        className="w-full py-3 px-4 bg-slate-800 text-white rounded-xl font-bold text-sm text-center hover:bg-slate-900 transition-all flex items-center justify-center gap-2 shadow-sm animate-fade-in-up"
                                    >
                                        <CheckCircle size={16} />
                                        Quieres finalizar el itinerario?
                                    </button>
                                )}
                            </div>
                        )}
                      </div>

                    /* CASE 3: SUMMARY PHASE */
                    ) : msg.type === 'summary_phase' && msg.itinerarySummary ? (
                        <div className="p-4 md:p-6 bg-slate-50 border-t border-slate-100">
                             <div className="text-center mb-6">
                                <h3 className="text-xl font-bold text-slate-800 font-serif mb-1">Tu Itinerario en Futaleufú</h3>
                                <div className="flex items-center justify-center gap-4 text-sm text-slate-500">
                                    <div className="flex items-center gap-1"><Calendar size={14}/> {getDaysDiff(startDate, endDate)} Días</div>
                                    <div className="flex items-center gap-1">{getTransportIcon(transport)}</div>
                                </div>
                            </div>

                            <div className="space-y-0 relative border-l-2 border-emerald-100 ml-3">
                                {msg.itinerarySummary.map((item, i) => (
                                    <div key={i} className="mb-6 ml-6 relative">
                                        <span className="absolute -left-[33px] top-1 w-4 h-4 rounded-full bg-emerald-500 border-2 border-white shadow-sm ring-2 ring-emerald-100"></span>
                                        <p className="text-xs font-bold text-emerald-600 uppercase tracking-wide mb-1">Día {item.day}</p>
                                        <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm flex items-center gap-3">
                                            <span className="text-2xl">{item.emoji || '🌲'}</span>
                                            <p className="font-bold text-slate-700">{item.title}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="mt-6 pt-4 border-t border-slate-200 text-center">
                                <p className="text-slate-600 italic text-sm mb-4">
                                    "{cleanText(msg.content)}"
                                </p>
                                <button onClick={handleStartPlan} className="text-emerald-600 font-bold text-sm hover:underline">
                                    Armar otro plan
                                </button>
                            </div>
                        </div>

                    ) : (
                        // FALLBACK: Plain text
                      <div className="p-3 whitespace-pre-wrap leading-relaxed">
                        <LinkRenderer text={msg.content} />
                      </div>
                    )}

                    {/* GOOGLE GROUNDING SOURCES */}
                    {msg.sources && msg.sources.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-slate-100/50 mx-3 mb-1">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Fuentes consultadas:</p>
                            <div className="flex flex-wrap gap-2">
                                {msg.sources.map((src, i) => (
                                    <a 
                                        key={i} 
                                        href={src.url} 
                                        target="_blank" 
                                        rel="noopener noreferrer"
                                        className="text-[10px] bg-slate-100 text-slate-600 px-2 py-1 rounded hover:bg-slate-200 truncate max-w-[180px] block border border-slate-200 transition-colors"
                                        title={src.title}
                                    >
                                        {src.title}
                                    </a>
                                ))}
                            </div>
                        </div>
                    )}

                  </div>
                </div>
              ))}

              {/* Loading Indicator */}
              {isTyping && (
                <div className="flex justify-start animate-pulse">
                   <div className="w-8 h-8 rounded-full bg-emerald-100 border border-emerald-200 flex items-center justify-center mr-3 mt-1">
                       <span className="text-emerald-700 text-xs font-bold font-serif">AI</span>
                   </div>
                   <div className="bg-white border border-slate-100 rounded-2xl rounded-tl-none px-4 py-3 shadow-sm flex items-center gap-1.5">
                     <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"></span>
                     <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce delay-100"></span>
                     <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce delay-200"></span>
                   </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
            
            {/* INPUT AREA */}
            <div className="p-4 md:p-6 bg-white border-t border-slate-200 z-20">
                <div className="relative max-w-4xl mx-auto flex items-center gap-2">
                    <input
                        type="text"
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                        placeholder="Pregúntame lo que quieras... (ej: Dónde comer pizza?)"
                        disabled={isTyping}
                        className="flex-1 py-3 px-4 bg-slate-50 border border-slate-200 rounded-xl text-slate-700 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none shadow-sm transition-all disabled:opacity-60"
                    />
                    <button 
                        onClick={handleSendMessage}
                        disabled={!inputValue.trim() || isTyping}
                        className="p-3 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 transition-colors shadow-sm"
                    >
                        <SendHorizontal size={20} />
                    </button>
                </div>
            </div>

          </div>
        </>
      )}
    </div>
  );
}