import { ReactNode } from 'react';

export enum Sender {
  User = 'user',
  AI = 'ai',
  System = 'system'
}

export interface Option {
  id: string;
  title: string;
  emoji?: string; // Dynamic emoji representing the attraction
  desc: string;
  vibe: string;
  time: string;
}

export interface Source {
  title: string;
  url: string;
}

export interface Message {
  id: string;
  sender: Sender;
  content: string; // Raw text or main message
  type?: 'text' | 'welcome_phase' | 'detail_phase' | 'summary_phase';
  
  // UI specific fields
  subContent?: string;
  options?: Option[];
  sources?: Source[]; // Google Search Grounding sources
  
  // Detail phase fields
  title?: string;
  steps?: string[];
  highlight?: string;
  warning?: string;
  
  // Summary phase fields
  itinerarySummary?: { day: number; title: string; emoji?: string }[];
  
  timestamp: Date;
}

export interface WeatherData {
  temp: number;
  condition: string;
  description: string;
  icon: string; // URL or icon name
  feelsLike: number;
  humidity: number;
}

export type TransportType = 'foot' | 'auto' | 'bike' | 'bus';
export type VibeType = 'aventura' | 'relax' | 'vistas';

export interface TripConfig {
  days: number;
  transport: TransportType;
  vibe: VibeType;
}