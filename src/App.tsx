import React, { useState, useEffect } from 'react';
import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  signOut, 
  doc, 
  onSnapshot, 
  setDoc, 
  collection, 
  addDoc, 
  serverTimestamp,
  updateDoc,
  query,
  where,
  getDocs,
  getDoc
} from './lib/firebase';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { 
  Wallet, 
  Coins, 
  Share2, 
  History, 
  ExternalLink, 
  CheckCircle2, 
  AlertCircle,
  LogOut,
  User as UserIcon,
  TrendingUp,
  Gift,
  Shield
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

interface UserData {
  uid: string;
  email: string | null;
  points: number;
  referralCode: string;
  referredBy?: string;
  notification?: {
    message: string;
    type: 'info' | 'success' | 'error';
    timestamp: number;
  };
}

interface Withdrawal {
  id: string;
  userId: string;
  userEmail?: string;
  amountPoints: number;
  amountRs: number;
  method: string;
  accountName: string;
  accountNumber: string;
  status: 'pending' | 'Approved' | 'rejected';
  createdAt: any;
}

const TechLogo = ({ className = "w-10 h-10" }: { className?: string }) => (
  <svg viewBox="0 0 100 100" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="logo-grad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#4F46E5" />
        <stop offset="100%" stopColor="#06B6D4" />
      </linearGradient>
      <filter id="neon-glow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="3" result="blur" />
        <feComposite in="SourceGraphic" in2="blur" operator="over" />
      </filter>
    </defs>
    <path d="M50 5 L85 25 L85 75 L50 95 L15 75 L15 25 Z" stroke="url(#logo-grad)" strokeWidth="4" filter="url(#neon-glow)" />
    <path d="M35 35 L65 35 L65 50 L35 50 L65 75" stroke="#E2E8F0" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="50" cy="50" r="15" stroke="url(#logo-grad)" strokeWidth="2" strokeDasharray="4 4" />
    <path d="M50 15 L50 25 M85 50 L75 50 M50 85 L50 75 M15 50 L25 50" stroke="#06B6D4" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

// --- Utils ---
const generateReferralCode = () => Math.random().toString(36).substring(2, 8).toUpperCase();

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'earn' | 'withdraw' | 'admin'>('dashboard');
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [allWithdrawals, setAllWithdrawals] = useState<Withdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNotification, setShowNotification] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);

  // --- Auth & Data Prep ---
  useEffect(() => {
    document.title = "Rewards Hub";
    // Check for referral code in URL
    const params = new URLSearchParams(window.location.search);
    const refCode = params.get('ref');

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        // Recovery logic for tasks
        const savedTask = localStorage.getItem('pendingTask');
        if (savedTask) {
          try {
            const { task, startTime, userId } = JSON.parse(savedTask);
            if (userId === currentUser.uid) {
              const elapsed = (Date.now() - startTime) / 1000;
              const duration = 15; 
              setCurrentTask(task);
              setIsTaskRunning(true);
              if (elapsed < duration) {
                setTimeRemaining(Math.ceil(duration - elapsed));
              } else {
                setTimeRemaining(0);
                // We'll let the effect handle the auto claim if timeRemaining is 0
              }
            } else {
              localStorage.removeItem('pendingTask');
            }
          } catch (e) {
            localStorage.removeItem('pendingTask');
          }
        }

        const userDocRef = doc(db, 'users', currentUser.uid);
        onSnapshot(userDocRef, (snapshot) => {
          if (snapshot.exists()) {
            const data = snapshot.data() as UserData;
            setUserData(data);
            if (data.notification && (!userData?.notification || data.notification.timestamp !== userData.notification.timestamp)) {
              setShowNotification(true);
            }
          } else {
            // Create new profile with referral tracking
            const referralCode = generateReferralCode();
            setDoc(userDocRef, {
              uid: currentUser.uid,
              email: currentUser.email,
              points: 0,
              referralCode,
              referredBy: refCode || null, // Store if they came from a link
              hasPerformedFirstTask: false,
              createdAt: serverTimestamp()
            }, { merge: true }).catch(err => handleFirestoreError(err, OperationType.WRITE, 'users/' + currentUser.uid));
          }
        }, (err) => handleFirestoreError(err, OperationType.GET, 'users/' + currentUser.uid));

        // Admin: Listen for all withdrawals if authorized, otherwise just user's own
        if (currentUser.email === "mohsinatiq345@gmail.com") {
          const allQ = collection(db, 'withdrawals');
          onSnapshot(allQ, (snapshot) => {
            const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Withdrawal));
            const sortedList = list.sort((a,b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
            setAllWithdrawals(sortedList);
            // Also update the 'withdrawals' state so admin sees their own history too if they have any
            const userOnes = sortedList.filter(w => w.userId === currentUser.uid);
            setWithdrawals(userOnes);
          }, (err) => handleFirestoreError(err, OperationType.LIST, 'withdrawals'));
        } else {
          // Listen for user's withdrawals only
          const q = query(collection(db, 'withdrawals'), where('userId', '==', currentUser.uid));
          onSnapshot(q, (snapshot) => {
            const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Withdrawal));
            setWithdrawals(list.sort((a,b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)));
          }, (err) => handleFirestoreError(err, OperationType.LIST, 'withdrawals (query)'));
        }
      } else {
        setUserData(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Keyboard shortcut for Mac (Cmd + P)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
        e.preventDefault();
        setActiveTab('admin');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const login = () => signInWithPopup(auth, googleProvider);
  const logout = () => signOut(auth);

  const [isTaskRunning, setIsTaskRunning] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const [isProcessingClaim, setIsProcessingClaim] = useState(false);
  const [currentTask, setCurrentTask] = useState<{amount: number, type: 'ad'} | null>(null);
  const [withdrawAmountRs, setWithdrawAmountRs] = useState<string>("");

  // Timer for task verification
  useEffect(() => {
    let interval: any;
    if (timeRemaining !== null && timeRemaining > 0 && isTaskRunning) {
      interval = setInterval(() => {
        setTimeRemaining(prev => {
          if (prev && prev <= 1) {
            clearInterval(interval);
            if (currentTask && user) handleAutoClaim(currentTask, user.uid);
            return 0;
          }
          return prev ? prev - 1 : 0;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [timeRemaining, isTaskRunning, currentTask, user]);

  const startTask = (amount: number, type: 'ad') => {
    if (isTaskRunning || !user) return;
    
    const proceed = window.confirm("Do you want to start the 15-second timer to earn points? You must stay on this page to claim rewards.");
    if (!proceed) return;

    // Save to localStorage so it persists after redirect/reload
    localStorage.setItem('pendingTask', JSON.stringify({
      task: { amount, type },
      startTime: Date.now(),
      userId: user.uid
    }));
    
    const adLink = "https://omg10.com/4/10791490";
    window.open(adLink, '_blank');
    
    // Immediately trigger the timer in the UI
    setIsTaskRunning(true);
    setTimeRemaining(15);
    setCurrentTask({ amount, type });
  };

  const handleAutoClaim = async (task: {amount: number, type: string}, uid: string) => {
    if (isProcessingClaim) return;
    setIsProcessingClaim(true);
    
    try {
      const { amount, type } = task;
      const userRef = doc(db, 'users', uid);
      const userSnap = await getDoc(userRef).catch(err => handleFirestoreError(err, OperationType.GET, 'users/' + uid));
      
      if (userSnap && userSnap.exists()) {
        const currentData = userSnap.data();
        const updates: any = { 
          points: (currentData.points || 0) + amount 
        };

        if (!currentData.hasPerformedFirstTask && currentData.referredBy) {
          const referrerQuery = query(collection(db, 'users'), where('referralCode', '==', currentData.referredBy));
          const referrerSnap = await getDocs(referrerQuery).catch(err => handleFirestoreError(err, OperationType.LIST, 'users (referral query)'));
          
          if (referrerSnap && !referrerSnap.empty) {
            const referrerDoc = referrerSnap.docs[0];
            await updateDoc(doc(db, 'users', referrerDoc.id), {
              points: (referrerDoc.data().points || 0) + 15,
              notification: {
                message: `Referral Bonus! Your friend completed a task. You earned 15 pts.`,
                type: 'success',
                timestamp: Date.now()
              }
            }).catch(err => handleFirestoreError(err, OperationType.WRITE, 'users/' + referrerDoc.id));
          }
          updates.hasPerformedFirstTask = true;
        }

        await updateDoc(userRef, updates).catch(err => handleFirestoreError(err, OperationType.WRITE, 'users/' + uid));
        await addDoc(collection(db, 'transactions'), {
          userId: uid,
          type,
          points: amount,
          createdAt: serverTimestamp()
        }).catch(err => handleFirestoreError(err, OperationType.WRITE, 'transactions'));
      }
    } catch (err) {
      console.error("Claim error:", err);
    } finally {
      localStorage.removeItem('pendingTask');
      setIsTaskRunning(false);
      setIsProcessingClaim(false);
      setCurrentTask(null);
      setTimeRemaining(null);
      alert("Verification successful! Points added.");
    }
  };

  const handleWithdrawal = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user || !userData) return;
    
    const formData = new FormData(e.currentTarget);
    const method = formData.get('method') as string;
    const accountName = formData.get('accountName') as string;
    const accountNumber = formData.get('accountNumber') as string;
    const amountRs = Number(formData.get('amountRs'));
    const amountPoints = amountRs * 100;

    if (userData.points < amountPoints) {
      alert("Insufficient points! (100 pts = 1 Rs)");
      return;
    }

    try {
      // 1. Deduct points
      await updateDoc(doc(db, 'users', user.uid), {
        points: userData.points - amountPoints
      }).catch(err => handleFirestoreError(err, OperationType.WRITE, 'users/' + user.uid));

      // 2. Create withdrawal record
      await addDoc(collection(db, 'withdrawals'), {
        userId: user.uid,
        userEmail: user.email,
        amountPoints,
        amountRs,
        method,
        accountName,
        accountNumber,
        status: 'pending',
        createdAt: serverTimestamp()
      }).catch(err => handleFirestoreError(err, OperationType.WRITE, 'withdrawals'));

      setWithdrawAmountRs("");
      alert("Withdrawal request submitted! Admin will verify soon.");
    } catch (err) {
      console.error(err);
      alert("Something went wrong.");
    }
  };

  const verifyWithdrawal = async (id: string) => {
    await updateDoc(doc(db, 'withdrawals', id), { status: 'Approved' }).catch(err => handleFirestoreError(err, OperationType.WRITE, 'withdrawals/' + id));
    alert("Withdrawal Approved.");
  };

  // --- Admin Logic ---
  const handleAdminVerify = async (withdrawal: Withdrawal, message: string) => {
    await updateDoc(doc(db, 'withdrawals', withdrawal.id), { status: 'Approved' }).catch(err => handleFirestoreError(err, OperationType.WRITE, 'withdrawals/' + withdrawal.id));
    await updateDoc(doc(db, 'users', withdrawal.userId), {
      notification: {
        message: message || "Your withdrawal has been approved!",
        type: 'success',
        timestamp: Date.now()
      }
    }).catch(err => handleFirestoreError(err, OperationType.WRITE, 'users/' + withdrawal.userId));
  };

  const handleAdminReject = async (withdrawal: Withdrawal, message: string) => {
    await updateDoc(doc(db, 'withdrawals', withdrawal.id), { status: 'rejected' }).catch(err => handleFirestoreError(err, OperationType.WRITE, 'withdrawals/' + withdrawal.id));
    // Refund points
    const userRef = doc(db, 'users', withdrawal.userId);
    const snap = await getDoc(userRef).catch(err => handleFirestoreError(err, OperationType.GET, 'users/' + withdrawal.userId));
    if (snap && snap.exists()) {
      const currentPoints = snap.data().points || 0;
      await updateDoc(userRef, { 
        points: currentPoints + withdrawal.amountPoints,
        notification: {
          message: message || "Withdrawal rejected. Points refunded.",
          type: 'error',
          timestamp: Date.now()
        }
      }).catch(err => handleFirestoreError(err, OperationType.WRITE, 'users/' + withdrawal.userId));
    }
  };

  const sendCustomMessage = async (userId: string, message: string) => {
    await updateDoc(doc(db, 'users', userId), {
      notification: {
        message,
        type: 'info',
        timestamp: Date.now()
      }
    }).catch(err => handleFirestoreError(err, OperationType.WRITE, 'users/' + userId));
    alert("Message sent!");
  };

  if (loading) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center font-bold text-gray-400">LOADING HUB...</div>;
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-background-deep flex flex-col items-center justify-center p-6 text-white text-center relative overflow-hidden">
        {/* Decorative elements */}
        <div className="absolute top-[-10%] right-[-10%] w-[60%] h-[60%] bg-brand-primary/20 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[60%] h-[60%] bg-brand-secondary/20 blur-[120px] rounded-full" />
        
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }} 
          animate={{ opacity: 1, scale: 1 }} 
          className="space-y-8 max-w-sm w-full relative z-10"
        >
               <div className="flex justify-between items-start">
                  <div className="w-20 h-20 bg-slate-900 rounded-[2.5rem] mx-auto flex items-center justify-center shadow-2xl shadow-brand-primary/30 rotate-12 border-4 border-white/10">
                    <TechLogo className="w-12 h-12 -rotate-12" />
                  </div>
                  <div className="space-y-2">
                    <h1 className="text-5xl font-display font-black tracking-tight leading-none bg-clip-text text-transparent bg-gradient-to-b from-white to-white/60">
                      REWARDS<br/>HUB PK
                    </h1>
                    <div className="flex items-center gap-2 justify-center">
                      <div className="h-0.5 w-4 bg-brand-primary" />
                      <p className="text-slate-400 font-black text-[10px] uppercase tracking-widest">Official Rewards Hub</p>
                      <div className="h-0.5 w-4 bg-brand-primary" />
                    </div>
                  </div>
                </div>

          <div className="space-y-4 pt-4">
            <button 
              onClick={login}
              className="w-full bg-white text-slate-900 font-bold py-4 rounded-3xl shadow-2xl flex items-center justify-center gap-3 hover:translate-y-[-2px] hover:shadow-white/10 transition-all active:scale-[0.98] group"
            >
              <img src="https://www.google.com/favicon.ico" className="w-5 h-5 group-hover:scale-110 transition-transform" alt="google" />
              <span>Continue with Google</span>
            </button>
            <div className="flex items-center gap-3 px-2">
              <div className="h-px flex-1 bg-white/10" />
              <span className="text-[10px] uppercase font-black tracking-[0.2em] text-white/30">Official Partner</span>
              <div className="h-px flex-1 bg-white/10" />
            </div>
            <div className="grid grid-cols-2 gap-4">
               <div className="bg-white/5 border border-white/10 p-3 rounded-2xl flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-orange-500/20 flex items-center justify-center text-orange-500 text-[10px] font-black underline">JC</div>
                  <span className="text-[10px] font-bold text-white/60">JazzCash</span>
               </div>
               <div className="bg-white/5 border border-white/10 p-3 rounded-2xl flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-500 text-[10px] font-black underline">EP</div>
                  <span className="text-[10px] font-bold text-white/60">EasyPaisa</span>
               </div>
            </div>
          </div>
          
          <p className="text-[10px] text-white/20 font-black uppercase tracking-widest pt-8">
            100 Points = 1 RS • No Fees Applied
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans pb-24">
      {/* Notification Popup */}
      <AnimatePresence>
        {showNotification && userData?.notification && (
          <motion.div 
            initial={{ opacity: 0, y: -50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -50 }}
            className="fixed top-20 left-4 right-4 z-[100] p-4 rounded-2xl shadow-2xl flex items-start gap-4 border bg-white"
            style={{ 
              borderColor: userData.notification.type === 'success' ? '#10b981' : userData.notification.type === 'error' ? '#ef4444' : '#6366f1'
            }}
          >
             {userData.notification.type === 'success' ? <CheckCircle2 className="text-emerald-500 shrink-0" /> : <AlertCircle className="text-amber-500 shrink-0" />}
             <div className="flex-1">
                <h4 className="font-bold text-sm">System Update</h4>
                <p className="text-xs text-gray-500">{userData.notification.message}</p>
             </div>
             <button onClick={() => setShowNotification(false)} className="text-gray-400 font-bold p-1">×</button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="bg-white/70 backdrop-blur-xl border-b border-slate-200/50 p-4 sticky top-0 z-[60]">
        <div className="max-w-xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center shadow-lg shadow-brand-primary/20 rotate-3 border-2 border-white/10">
              <TechLogo className="w-6 h-6 -rotate-3" />
            </div>
            <div className="flex flex-col -space-y-1">
              <span className="font-display font-black text-xl tracking-tight text-slate-900 leading-none">REWARDS</span>
              <span className="font-display font-black text-xs tracking-[0.2em] text-brand-primary ml-0.5">HUB PK</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
             <motion.div 
               whileHover={{ scale: 1.02 }}
               className="bg-slate-900 text-white pl-1.5 pr-4 py-1.5 rounded-2xl flex items-center gap-2 shadow-xl shadow-slate-900/10 cursor-pointer"
               onClick={() => setActiveTab('dashboard')}
             >
               <div className="w-7 h-7 bg-white/10 rounded-xl flex items-center justify-center">
                 <Coins className="w-3.5 h-3.5 text-brand-primary" />
               </div>
               <div className="flex flex-col -space-y-1">
                 <span className="font-display font-black text-sm tabular-nums">
                   {userData ? userData.points : "..."} 
                   <span className="text-[10px] text-white/50 ml-1">PTS</span>
                 </span>
                 {!userData && <span className="text-[8px] text-white/30 font-black uppercase tracking-widest">Syncing</span>}
               </div>
             </motion.div>
             <button onClick={logout} className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-2xl transition-all">
               <LogOut className="w-5 h-5" />
             </button>
          </div>
        </div>
      </header>

      <main className="max-w-xl mx-auto p-4 space-y-6">
        <AnimatePresence mode="wait">
          {activeTab === 'dashboard' && (
            <motion.div 
              key="dash"
              initial={{ opacity: 0, x: -10 }} 
              animate={{ opacity: 1, x: 0 }} 
              exit={{ opacity: 0, x: 10 }}
              className="space-y-6"
            >
              {/* Balance Card */}
              <div className="relative group">
                <div className="absolute -inset-1 bg-gradient-to-r from-brand-primary to-brand-secondary rounded-[2.5rem] blur opacity-25 group-hover:opacity-40 transition-opacity" />
                <div className="relative bg-slate-900 rounded-[2.5rem] p-8 text-white overflow-hidden shadow-2xl">
                  <div className="relative z-10 space-y-8">
                    <div className="flex justify-between items-start">
                      <div className="space-y-1">
                        <span className="text-white/40 font-display font-black uppercase tracking-[0.2em] text-[10px]">Vault Balance</span>
                        <div className="text-6xl font-display font-black tracking-tight flex items-baseline gap-2">
                          {userData?.points || 0}
                          <span className="text-lg font-bold text-brand-primary">PTS</span>
                        </div>
                      </div>
                      <div className="p-3 bg-white/5 rounded-2xl border border-white/10 backdrop-blur-md">
                        <Wallet className="w-6 h-6 text-brand-primary" />
                      </div>
                    </div>

                    <div className="space-y-4 pt-4">
                      <div className="space-y-2">
                        <div className="flex justify-between text-[10px] font-black uppercase tracking-widest">
                          <span className="text-white/40">Tier Progress</span>
                          <span className="text-brand-primary">72%</span>
                        </div>
                        <div className="h-3 w-full bg-white/5 rounded-full p-1 border border-white/10">
                          <motion.div 
                            className="h-full bg-gradient-to-r from-brand-primary to-brand-secondary rounded-full shadow-lg shadow-brand-primary/50" 
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.min((userData?.points || 0) / 10, 100)}%` }} 
                          />
                        </div>
                      </div>
                      <div className="flex justify-between items-center bg-white/5 rounded-2xl p-4 border border-white/10">
                         <div className="flex items-center gap-3">
                           <div className="w-8 h-8 bg-brand-primary/20 rounded-xl flex items-center justify-center">
                             <TrendingUp className="w-4 h-4 text-brand-primary" />
                           </div>
                           <div className="space-y-0.5">
                              <p className="text-[10px] text-white/40 uppercase font-black">Estimated Value</p>
                              <p className="text-sm font-bold">Rs {(userData?.points || 0) / 100}</p>
                           </div>
                         </div>
                         <button 
                           onClick={() => setActiveTab('withdraw')}
                           className="bg-brand-primary text-white text-[10px] font-black uppercase px-4 py-2 rounded-xl transition-transform active:scale-95"
                         >
                           Payout
                         </button>
                      </div>
                    </div>
                  </div>
                  {/* Decorative mesh */}
                  <div className="absolute top-0 right-0 w-64 h-64 bg-brand-primary/20 blur-[60px] translate-x-1/2 -translate-y-1/2" />
                </div>
              </div>

              {/* Referral Tool */}
              <div className="glass-card p-6 space-y-6">
                <div className="flex items-center gap-4">
                   <div className="w-12 h-12 bg-pink-100 rounded-[1.25rem] flex items-center justify-center text-pink-500 shadow-inner">
                     <Share2 className="w-6 h-6" />
                   </div>
                   <div className="space-y-0.5">
                     <h3 className="font-display font-black text-lg tracking-tight">Referral Network</h3>
                     <p className="text-xs text-slate-400 font-medium">Earn <span className="text-pink-500 font-bold">15 PTS</span> for every active referral.</p>
                   </div>
                </div>
                <div className="flex gap-2">
                   <div 
                    className="flex-1 bg-slate-50 border border-slate-200/50 rounded-2xl px-5 py-3.5 font-display font-black text-slate-600 flex items-center justify-between cursor-pointer group"
                    onClick={() => {
                        navigator.clipboard.writeText(userData?.referralCode || "");
                        alert("Referral code copied!");
                    }}
                   >
                     {userData?.referralCode}
                     <div className="w-8 h-8 bg-white border border-slate-200 rounded-lg flex items-center justify-center group-active:scale-90 transition-transform">
                        <Share2 className="w-3.5 h-3.5 text-slate-400" />
                     </div>
                   </div>
                   <button 
                     onClick={() => {
                       const link = `https://rewardshub.pk/join?ref=${userData?.referralCode}`;
                       navigator.share ? navigator.share({ title: 'Join Rewards Hub', text: 'Earn points with me!', url: link }) : alert(link);
                     }}
                     className="bg-slate-900 text-white px-8 rounded-2xl font-display font-black text-xs uppercase tracking-widest shadow-xl shadow-slate-900/20 active:scale-95 transition-transform"
                    >
                      Invite
                   </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 pb-4">
                 <div className="glass-card p-4 flex flex-col gap-3">
                    <div className="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center">
                      <TrendingUp className="w-5 h-5 text-orange-600" />
                    </div>
                    <div className="space-y-0.5">
                      <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Total Earned</p>
                      <h4 className="font-display font-black text-xl">Rs {(userData?.points || 0) / 100}</h4>
                    </div>
                 </div>
                 <div className="glass-card p-4 flex flex-col gap-3">
                    <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
                      <Wallet className="w-5 h-5 text-emerald-600" />
                    </div>
                    <div className="space-y-0.5">
                      <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Withdrawn</p>
                      <h4 className="font-display font-black text-xl">Rs {withdrawals.filter(w => w.status === 'verified').reduce((acc, curr) => acc + curr.amountRs, 0)}</h4>
                    </div>
                 </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'earn' && (
            <motion.div 
              key="earn"
              initial={{ opacity: 0, scale: 0.95 }} 
              animate={{ opacity: 1, scale: 1 }} 
              exit={{ opacity: 0, scale: 0.95 }}
              className="space-y-6 pt-4"
            >
              <div className="space-y-1.5 px-2">
                <h2 className="text-3xl font-display font-black text-slate-900 tracking-tight flex items-center gap-3">
                   EARN <span className="text-brand-primary">POINTS</span>
                   <div className="h-px flex-1 bg-slate-200" />
                </h2>
                <p className="text-slate-400 font-medium text-sm">Complete micro-tasks to fill your digital vault.</p>
              </div>

              {isTaskRunning && (
                <motion.div 
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  className="bg-slate-900 text-white p-6 rounded-[2rem] flex flex-col items-center gap-4 shadow-2xl relative overflow-hidden"
                >
                  <div className="absolute top-0 right-0 w-32 h-32 bg-brand-primary/20 blur-[40px]" />
                  <div className="w-16 h-16 bg-white/5 rounded-2xl flex items-center justify-center border border-white/10">
                    <History className={timeRemaining && timeRemaining > (0) ? "animate-spin text-brand-primary w-8 h-8" : "text-emerald-500 w-8 h-8"} />
                  </div>
                  <div className="text-center space-y-1">
                    <h4 className="font-display font-black uppercase text-xl tracking-tight">
                      {timeRemaining && timeRemaining > 0 ? "VERIFYING VIEW" : "PROCESSING..."}
                    </h4>
                    <p className="text-white/40 font-medium text-xs">
                      {timeRemaining && timeRemaining > 0 
                        ? `Stay on this page for ${timeRemaining}s. Do not minimize.` 
                        : "Verification successful. Finalizing credit."}
                    </p>
                  </div>
                  <div className="w-full bg-white/5 h-3 rounded-full p-0.5 border border-white/10 mt-2">
                    <motion.div 
                      className="h-full bg-gradient-to-r from-brand-primary to-brand-secondary rounded-full shadow-[0_0_15px_rgba(99,102,241,0.5)]"
                      initial={{ width: "100%" }}
                      animate={{ width: `${(timeRemaining || 0) / 15 * 100}%` }}
                    />
                  </div>
                </motion.div>
              )}

              <div className="grid gap-4">
                <EarnCard 
                  title="Daily Ad Video" 
                  desc="Watch a high-impact video ad to earn coins instantly." 
                  pts="5" 
                  disabled={isTaskRunning}
                  onClick={() => startTask(5, 'ad')} 
                  icon={<ExternalLink className="w-5 h-5" />}
                  color="indigo"
                />
                
                <div className="glass-card p-5 bg-amber-50/30 border-amber-200/50 flex items-start gap-4">
                  <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center shrink-0">
                    <AlertCircle className="w-5 h-5 text-amber-600" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-display font-black uppercase text-amber-900 tracking-wider">Security Protocol</p>
                    <p className="text-[11px] text-amber-700 leading-relaxed font-medium">
                      VPN usage or automated bots are strictly prohibited. Detected fraud results in immediate account suspension and point forfeiture.
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'withdraw' && (
            <motion.div 
              key="withdraw"
              initial={{ opacity: 0, scale: 0.95 }} 
              animate={{ opacity: 1, scale: 1 }} 
              exit={{ opacity: 0, scale: 0.95 }}
              className="space-y-8 pt-4 pb-12"
            >
              <form onSubmit={handleWithdrawal} className="glass-card p-8 space-y-6">
                <div className="space-y-1 text-center">
                  <h3 className="font-display font-black text-2xl tracking-tight uppercase">Cash Out</h3>
                  <p className="text-slate-400 text-xs font-medium italic">100 Points = 1 RS • Minimum: 50 RS</p>
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex-1 cursor-pointer">
                    <input type="radio" name="method" value="JazzCash" className="hidden peer" defaultChecked />
                    <div className="p-4 border border-slate-200 rounded-2xl peer-checked:border-orange-500 peer-checked:bg-orange-50/50 text-center font-display font-black text-sm uppercase tracking-widest transition-all shadow-sm">
                      JazzCash
                    </div>
                  </label>
                  <label className="flex-1 cursor-pointer">
                    <input type="radio" name="method" value="EasyPaisa" className="hidden peer" />
                    <div className="p-4 border border-slate-200 rounded-2xl peer-checked:border-emerald-500 peer-checked:bg-emerald-50/50 text-center font-display font-black text-sm uppercase tracking-widest transition-all shadow-sm">
                      EasyPaisa
                    </div>
                  </label>
                </div>

                <div className="space-y-5">
                  <InputField name="accountName" label="Full Legal Name" placeholder="As on your account" required />
                  <InputField name="accountNumber" label="Account Number" placeholder="03XXXXXXXXX" required />
                  <div className="space-y-2">
                    <div className="flex justify-between items-end px-1">
                      <label className="text-[10px] font-display font-black text-slate-400 uppercase tracking-widest">Withdrawal Amount (PKR)</label>
                      <button 
                        type="button"
                        onClick={() => {
                          if (userData) {
                            const maxRs = Math.floor(userData.points / 100);
                            setWithdrawAmountRs(maxRs.toString());
                          }
                        }}
                        className="text-[10px] font-black text-brand-primary bg-brand-primary/10 px-2 py-0.5 rounded-md hover:bg-brand-primary/20 transition-all font-sans"
                      >
                        MAX
                      </button>
                    </div>
                    <div className="relative">
                      <input 
                        name="amountRs" 
                        type="number" 
                        placeholder="Min 50" 
                        min="50" 
                        required 
                        value={withdrawAmountRs}
                        onChange={(e) => setWithdrawAmountRs(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm font-medium focus:outline-none focus:ring-4 focus:ring-brand-primary/10 focus:border-brand-primary focus:bg-white transition-all shadow-inner"
                      />
                      <div className="absolute right-4 top-1/2 -translate-y-1/2 flex flex-col items-end pointer-events-none">
                        <span className="text-[9px] font-black text-slate-400 uppercase leading-none">Equals</span>
                        <span className="text-xs font-black text-brand-primary">{(Number(withdrawAmountRs) * 100) || 0} Pts</span>
                      </div>
                    </div>
                  </div>
                </div>

                <button type="submit" className="w-full bg-slate-900 text-white font-display font-black text-xs uppercase tracking-[0.2em] py-5 rounded-[2rem] shadow-2xl shadow-slate-900/20 active:scale-95 transition-all">
                  Initialize Payout
                </button>
              </form>

              <div className="space-y-4">
                <div className="flex items-center gap-3 px-2">
                  <History className="w-4 h-4 text-slate-400" />
                  <h3 className="font-display font-black text-sm uppercase tracking-widest text-slate-400">Vault History</h3>
                  <div className="h-px flex-1 bg-slate-200" />
                </div>
                
                <div className="space-y-3">
                  {withdrawals.length === 0 && (
                    <div className="glass-card p-12 text-center space-y-2 opacity-50">
                       <History className="w-8 h-8 text-slate-300 mx-auto" />
                       <p className="text-xs font-bold text-slate-400">No transactions recorded.</p>
                    </div>
                  )}
                  {withdrawals.map((w) => (
                    <div key={w.id} className="glass-card p-4 flex items-center justify-between border-slate-100">
                       <div className="flex items-center gap-4">
                         <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${w.method === 'JazzCash' ? 'bg-orange-100 text-orange-600' : 'bg-emerald-100 text-emerald-600'}`}>
                           <span className="font-display font-black text-[10px]">{w.method === 'JazzCash' ? 'JC' : 'EP'}</span>
                         </div>
                         <div className="space-y-0.5">
                           <h4 className="font-display font-black text-base leading-none">Rs {w.amountRs}</h4>
                           <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tight">{w.accountNumber}</p>
                         </div>
                       </div>
                       <div className="text-right space-y-1.5">
                          <span className={`text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full ${w.status === 'pending' ? 'bg-amber-100 text-amber-700' : w.status === 'Approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                            {w.status === 'Approved' ? 'Approval' : w.status}
                          </span>
                          {w.status === 'pending' && user?.email === "mohsinatiq345@gmail.com" && (
                            <button onClick={() => verifyWithdrawal(w.id)} className="block w-full text-[9px] font-black underline text-brand-primary opacity-60">
                               MANUAL APPROVE
                            </button>
                          )}
                       </div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'admin' && (
            <motion.div 
              key="admin"
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              className="space-y-6"
            >
              {!isAdminAuthenticated ? (
                <div className="bg-white p-8 rounded-2xl shadow-xl text-center space-y-4">
                  <ShieldIcon className="w-12 h-12 text-brand-primary mx-auto" />
                  <h2 className="text-xl font-bold">Admin Verification</h2>
                  <input 
                    type="password" 
                    placeholder="Enter Admin Key" 
                    className="w-full border p-3 rounded-xl"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                  />
                  <button 
                    onClick={() => {
                      if (adminPassword === "mohsin1213") setIsAdminAuthenticated(true);
                      else alert("Wrong key!");
                    }}
                    className="w-full bg-indigo-600 text-white font-bold py-3 rounded-xl"
                  >
                    Authorize
                  </button>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <h2 className="text-2xl font-black">Control Panel</h2>
                    <div className="flex gap-2">
                       <button onClick={() => setIsAdminAuthenticated(false)} className="text-xs text-red-500 font-bold">Lock</button>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {allWithdrawals.length === 0 && <p className="text-center text-gray-400 py-12 italic">No requests.</p>}
                    {allWithdrawals.map(w => (
                      <AdminRequestCard 
                        key={w.id} 
                        request={w} 
                        onApprove={(msg) => handleAdminVerify(w, msg)}
                        onReject={(msg) => handleAdminReject(w, msg)}
                        onSendMsg={(msg) => sendCustomMessage(w.userId, msg)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Tabs Menu */}
      <nav className="fixed bottom-6 left-6 right-6 z-[80]">
        <div className="max-w-xl mx-auto glass-card flex justify-around p-2.5 shadow-2xl border-white/40 ring-1 ring-slate-900/5">
          <TabButton active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} icon={<TrendingUp />} label="Stats" />
          <TabButton active={activeTab === 'earn'} onClick={() => setActiveTab('earn')} icon={<Coins />} label="Earn" />
          <TabButton active={activeTab === 'withdraw'} onClick={() => setActiveTab('withdraw')} icon={<Wallet />} label="Payout" />
          {user?.email === "mohsinatiq345@gmail.com" && (
            <TabButton active={activeTab === 'admin'} onClick={() => setActiveTab('admin')} icon={<Shield />} label="Admin" />
          )}
        </div>
      </nav>
    </div>
  );
}

// --- Subcomponents ---

function StatCard({ icon, label, value, color }: { icon: any, label: string, value: string, color: string }) {
  return (
    <div className={`${color} p-4 rounded-2xl flex items-center gap-4`}>
       <div className="bg-white/50 p-2 rounded-lg">
          {icon}
       </div>
       <div>
         <p className="text-[10px] text-gray-500 font-bold uppercase">{label}</p>
         <h4 className="font-black text-gray-900">{value}</h4>
       </div>
    </div>
  );
}

function EarnCard({ title, desc, pts, onClick, icon, color, disabled }: { title: string, desc: string, pts: string, onClick: any, icon: any, color: string, disabled?: boolean }) {
  return (
    <div className={`glass-card p-5 flex items-center justify-between group transition-all duration-300 ${disabled ? 'opacity-40 grayscale pointer-events-none' : 'hover:border-brand-primary hover:shadow-brand-primary/5 active:scale-[0.98]'}`}>
       <div className="space-y-1.5 flex-1">
         <div className="flex items-center gap-2">
           <h3 className="font-display font-black text-slate-800 tracking-tight leading-none uppercase">{title}</h3>
           <div className="h-px w-4 bg-slate-200" />
           <span className="text-[10px] font-black text-brand-primary uppercase tracking-[0.15em] shrink-0">{pts} <span className="text-slate-400">pts</span></span>
         </div>
         <p className="text-[11px] text-slate-400 font-medium">{desc}</p>
       </div>
       <button onClick={onClick} className={`${color} w-12 h-12 rounded-2xl text-white shadow-xl flex items-center justify-center group-hover:scale-110 transition-all`}>
          {icon}
       </button>
    </div>
  );
}

function InputField({ label, ...props }: any) {
  return (
    <div className="space-y-2">
      <label className="text-[10px] font-display font-black text-slate-400 uppercase tracking-widest px-1">{label}</label>
      <input 
        className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm font-medium focus:outline-none focus:ring-4 focus:ring-brand-primary/10 focus:border-brand-primary focus:bg-white transition-all shadow-inner" 
        {...props} 
      />
    </div>
  );
}

function TabButton({ active, icon, label, onClick }: { active: boolean, icon: any, label: string, onClick: any }) {
  return (
    <button 
      onClick={onClick}
      className={`relative flex flex-col items-center gap-1 py-2 px-6 transition-all duration-300 ${active ? 'text-brand-primary' : 'text-slate-400'}`}
    >
      {active && (
        <motion.div 
          layoutId="activeTab"
          className="absolute inset-0 bg-brand-primary/5 rounded-2xl"
          transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
        />
      )}
      <div className={`relative transition-transform duration-300 ${active ? 'scale-110 -translate-y-0.5' : 'scale-100'}`}>
        {React.cloneElement(icon, { className: "w-6 h-6" })}
      </div>
      <span className={`text-[10px] font-display font-black uppercase tracking-widest relative ${active ? 'opacity-100' : 'opacity-40'}`}>{label}</span>
      {active && (
        <motion.div 
          layoutId="activeDot"
          className="absolute -top-1 w-1 h-1 bg-brand-primary rounded-full shadow-[0_0_8px_rgba(99,102,241,0.6)]" 
        />
      )}
    </button>
  );
}

function AdminRequestCard({ request, onApprove, onReject, onSendMsg }: any) {
  const [msg, setMsg] = useState("");
  return (
    <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-md space-y-4">
            <div className="flex justify-between items-start">
               <div className="space-y-1">
                  <div className="flex items-center gap-2">
                     <span className="font-black text-lg">Rs {request.amountRs}</span>
                     <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${request.status === 'pending' ? 'bg-amber-100 text-amber-700' : request.status === 'Approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                       {request.status === 'Approved' ? 'Approval' : request.status}
                     </span>
                  </div>
                  <p className="text-xs font-bold text-gray-400">{request.userEmail}</p>
               </div>
         <div className="text-right">
           <p className="text-xs font-bold">{request.method}</p>
           <p className="text-[10px] text-gray-400">{request.accountNumber}</p>
           <p className="text-[10px] text-gray-400">{request.accountName}</p>
         </div>
      </div>
      
      <div className="space-y-2">
        <textarea 
          placeholder="Message for user..." 
          className="w-full bg-gray-50 border p-2 rounded-lg text-xs"
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
        />
        <div className="flex gap-2">
           <button onClick={() => onApprove(msg)} className="flex-1 bg-emerald-600 text-white font-bold py-2 rounded-lg text-xs">Approve</button>
           <button onClick={() => onReject(msg)} className="flex-1 bg-red-600 text-white font-bold py-2 rounded-lg text-xs">Reject</button>
           <button onClick={() => onSendMsg(msg)} className="flex-1 bg-blue-600 text-white font-bold py-2 rounded-lg text-xs">Msg Only</button>
        </div>
      </div>
    </div>
  );
}

function ShieldIcon({ className }: { className?: string }) { return <Shield className={className} />; }
