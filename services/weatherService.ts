import { WeatherData } from '../types';

// Placeholder for the API Key - In a real app this comes from env
const API_KEY = 'bcc806cfcb75eadf866eeb865413599e'; 

export const getMockWeather = (): WeatherData => {
  return {
    temp: 14,
    condition: 'Nublado',
    description: 'Nubes dispersas',
    feelsLike: 13,
    humidity: 76,
    icon: '04d'
  };
};

export const getCurrentWeather = async (city: string = 'Futaleufú'): Promise<WeatherData> => {
  // Fallback to mock if no key or specific placeholder
  if (!API_KEY || API_KEY === 'bcc806cfcb75eadf866eeb865413599e') {
    console.warn('Using Mock Weather Data (No API Key provided)');
    return new Promise((resolve) => {
        setTimeout(() => resolve(getMockWeather()), 800); // Simulate network delay
    });
  }

  try {
    const response = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?q=${city},CL&appid=${API_KEY}&units=metric&lang=es`
    );

    if (!response.ok) {
      throw new Error('Weather fetch failed');
    }

    const data = await response.json();
    return {
      temp: Math.round(data.main.temp),
      condition: data.weather[0].main,
      description: data.weather[0].description,
      feelsLike: Math.round(data.main.feels_like),
      humidity: data.main.humidity,
      icon: data.weather[0].icon
    };
  } catch (error) {
    console.error('Error fetching weather:', error);
    return getMockWeather();
  }
};
