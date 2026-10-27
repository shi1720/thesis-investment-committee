import {applicationDefault,getApps,initializeApp,type App} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore} from 'firebase-admin/firestore';
let application:App|undefined;
export function firebaseAdmin(){
 const projectId=process.env.FIREBASE_PROJECT_ID??process.env.GOOGLE_CLOUD_PROJECT??process.env.GCLOUD_PROJECT;
 if(!projectId)throw new Error('Firebase project is not configured.');
 application??=getApps().find(a=>a.name==='thesis-api')??initializeApp({projectId,credential:applicationDefault()},'thesis-api');
 return {auth:getAuth(application),db:getFirestore(application,process.env.FIRESTORE_DATABASE_ID??'(default)')};
}
