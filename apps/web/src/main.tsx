import React from 'react';import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import App from './app/App.tsx';import './styles.css';
const client=new QueryClient({defaultOptions:{queries:{refetchOnWindowFocus:false,retry:1,staleTime:15000}}});
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><App/></QueryClientProvider>);
