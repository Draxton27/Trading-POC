import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({plugins:[react(),tailwindcss()],server:{host:'127.0.0.1',port:Number(process.env.TRADING_POC_WEB_PORT??5173),strictPort:true,proxy:{'/api':{target:`http://127.0.0.1:${Number(process.env.TRADING_POC_API_PORT??4300)}`,ws:true}}},preview:{host:'127.0.0.1'}});
