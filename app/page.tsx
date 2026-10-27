"use client";
import {useEffect} from 'react';
import Platform from '@/components/thesis-platform';
import {firebaseEnabled} from '@/lib/client/firebase-auth';
export default function Home(){
 useEffect(()=>{if(!firebaseEnabled&&window.location.hostname.endsWith('.chatgpt.site'))window.location.replace('https://thesis-investing.web.app');},[]);
 return <Platform/>;
}
