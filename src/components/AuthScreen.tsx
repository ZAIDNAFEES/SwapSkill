import React, { useState } from "react";
import { motion } from "motion/react";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
  signOut
} from "firebase/auth";
import { collection, query, where, getDocs } from "firebase/firestore";
import { auth, db } from "../firebase";
import { googleAuthService } from "../services/GoogleAuthService";
import { Mail, Lock, Eye, EyeOff, AlertTriangle, ArrowRight, RefreshCw, Check, User } from "lucide-react";
import logoImg from "../assets/logo.jpg";

interface AuthScreenProps {
  onSuccess: (userId: string, isNewUser: boolean) => void;
}

type Mode = "login" | "signup" | "forgot" | "verify";

export default function AuthScreen({ onSuccess }: AuthScreenProps) {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError("Please fill out all fields.");
      return;
    }
    setError("");
    setInfo("");
    setLoading(true);

    try {
      if (mode === "signup") {
        const credential = await createUserWithEmailAndPassword(auth, email, password);
        try {
          await sendEmailVerification(credential.user);
          setInfo("A verification email has been sent to " + email + ". Please verify before continuing!");
          setMode("verify");
        } catch (verifErr: any) {
          console.error("Verification email failed:", verifErr);
          setIsSuccess(true);
          onSuccess(credential.user.uid, true);
        }
      } else {
        let targetEmail = email.trim();

        // Resolve username to email if input doesn't look like a standard email address
        if (!targetEmail.includes("@") || !targetEmail.includes(".")) {
          const cleanUsername = targetEmail.replace(/^@/, "").toLowerCase();
          if (!cleanUsername) {
            setError("Please enter a valid email address or username.");
            setLoading(false);
            return;
          }

          const usersRef = collection(db, "users");
          let userSnap = await getDocs(query(usersRef, where("username", "==", cleanUsername)));

          if (userSnap.empty) {
            userSnap = await getDocs(query(usersRef, where("handle", "==", cleanUsername)));
          }

          if (userSnap.empty) {
            // Case-insensitive fallback
            const allUsersSnap = await getDocs(usersRef);
            const matchedDoc = allUsersSnap.docs.find((d) => {
              const data = d.data();
              const u = (data.username || data.handle || "").toLowerCase().replace(/^@/, "");
              return u === cleanUsername;
            });

            if (matchedDoc && matchedDoc.data().email) {
              targetEmail = matchedDoc.data().email;
            } else {
              setError(`No account found matching username "@${cleanUsername}"`);
              setLoading(false);
              return;
            }
          } else {
            const matchedEmail = userSnap.docs[0].data().email;
            if (matchedEmail) {
              targetEmail = matchedEmail;
            } else {
              setError(`Account found for "@${cleanUsername}", but no email address is linked.`);
              setLoading(false);
              return;
            }
          }
        }

        const credential = await signInWithEmailAndPassword(auth, targetEmail, password);
        if (!credential.user.emailVerified) {
          setError("Your email address is not verified yet.");
          setMode("verify");
          setLoading(false);
          return;
        }
        setIsSuccess(true);
        onSuccess(credential.user.uid, false);
      }
    } catch (err: any) {
      console.error(err);
      let friendlyMessage = "Authentication failed. Please verify your credentials.";
      if (err.code === "auth/invalid-credential") {
        friendlyMessage = "Invalid email/username or password.";
      } else if (err.code === "auth/email-already-in-use") {
        friendlyMessage = "This email is already in use.";
      } else if (err.code === "auth/weak-password") {
        friendlyMessage = "Password should be at least 6 characters.";
      } else if (err.code === "auth/too-many-requests") {
        friendlyMessage = "Too many login attempts. Please try again later.";
      }
      setError(friendlyMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async (e?: React.MouseEvent | React.TouchEvent) => {
    if (e) {
      e.stopPropagation();
    }
    if (isGoogleLoading) return;

    setError("");
    setInfo("");
    setIsGoogleLoading(true);
    setLoading(true);

    try {
      const res = await googleAuthService.signIn();
      if (res.success && res.uid) {
        setIsSuccess(true);
        onSuccess(res.uid, res.isNewUser || false);
      } else {
        if (!res.isCancelled && res.error) {
          setError(res.error);
        }
      }
    } catch (err: any) {
      console.error("Google Sign-In Exception:", err);
      setError(err?.message || "Google sign-in failed. Please try again.");
    } finally {
      setIsGoogleLoading(false);
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      setError("Please enter your email address.");
      return;
    }
    setError("");
    setInfo("");
    setLoading(true);

    try {
      await sendPasswordResetEmail(auth, email);
      setInfo("Password reset link has been sent to " + email);
      setMode("login");
    } catch (err: any) {
      setError("Failed to send password reset email. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const checkVerificationStatus = async () => {
    setError("");
    setLoading(true);
    try {
      const user = auth.currentUser;
      if (user) {
        await user.reload();
        if (user.emailVerified) {
          setIsSuccess(true);
          onSuccess(user.uid, true);
        } else {
          setError("Still not verified. Please check your email inbox and click the link.");
        }
      } else {
        setError("No active user session. Please log in again.");
        setMode("login");
      }
    } catch (err) {
      setError("Failed to refresh verification status.");
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async () => {
    setError("");
    setInfo("");
    try {
      const user = auth.currentUser;
      if (user) {
        await sendEmailVerification(user);
        setInfo("Verification email re-sent!");
      }
    } catch (err) {
      setError("Too many requests. Please try again later.");
    }
  };

  const formContainerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.04,
        delayChildren: 0.08,
      }
    }
  };

  const formItemVariants = {
    hidden: { opacity: 0, y: 10 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.2, ease: "easeOut" }
    }
  };

  return (
    <div 
      className="h-full w-full flex-1 flex flex-col justify-start sm:justify-center items-center px-4 sm:px-6 py-8 sm:py-12 bg-[#F7F4EE] text-[#0D0D0F] font-sans overflow-y-auto overscroll-y-contain mobile-scroll relative touch-pan-y"
      style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}
    >
      
      {/* Background subtle radial warm tint */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-[#C9A96E]/5 rounded-full blur-[140px] pointer-events-none" />

      {/* Container Card */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        className="w-full max-w-sm mx-auto my-auto flex flex-col bg-[#FFFFFF] border border-[#E8E4DB] rounded-3xl p-6 sm:p-8 shadow-xs relative z-10"
      >
        
        {/* Centered Logo & Header */}
        <div className="text-center mb-6 flex flex-col items-center">
          <div className="w-14 h-14 border border-[#E8E4DB] rounded-2xl overflow-hidden bg-[#0D0D0F] p-1 mb-3 shadow-2xs">
            <img src={logoImg} alt="SwapSkill Logo" className="w-full h-full object-cover rounded-xl" referrerPolicy="no-referrer" />
          </div>
          
          <h1 className="font-sans font-semibold text-2xl text-[#0D0D0F] tracking-tight">
            SwapSkill
          </h1>
          
          <p className="text-xs text-[#71717A] mt-1 font-normal">
            Peer Skill Exchange
          </p>
        </div>

        {/* Error / Info Banners */}
        {error && (
          <motion.div 
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4 p-3 bg-[#F7F4EE] border border-[#E8E4DB] rounded-xl flex items-start gap-2 text-xs text-[#0D0D0F] font-normal"
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-[#71717A]" />
            <span className="break-words text-[11px]">{error}</span>
          </motion.div>
        )}
        {info && (
          <motion.div 
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4 p-3 bg-[#F7F4EE] border border-[#E8E4DB] rounded-xl flex items-start gap-2 text-xs text-[#0D0D0F] font-normal"
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-[#C9A96E]" />
            <span>{info}</span>
          </motion.div>
        )}

        {/* Verification View */}
        {mode === "verify" ? (
          <div className="flex flex-col gap-4 text-center">
            <p className="text-[#71717A] text-xs leading-relaxed">
              We sent a verification link to <span className="text-[#0D0D0F] font-semibold">{email || auth.currentUser?.email}</span>. Click it to verify your account.
            </p>

            <button
              id="auth-verify-refresh-btn"
              onClick={checkVerificationStatus}
              disabled={loading}
              className="w-full h-11 bg-[#0D0D0F] hover:bg-[#1A1A1D] text-[#F7F4EE] rounded-xl text-xs font-semibold uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer transition-all shadow-2xs"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              <span>Verify Email Status</span>
            </button>

            <div className="flex flex-col gap-2 mt-1">
              <button
                id="auth-resend-email-btn"
                onClick={handleResendVerification}
                className="text-xs text-[#71717A] hover:text-[#0D0D0F] transition font-medium cursor-pointer"
              >
                Resend verification email
              </button>
              <button
                id="auth-verify-cancel-btn"
                onClick={() => {
                  signOut(auth);
                  setMode("login");
                }}
                className="text-xs text-[#A1A1AA] hover:text-[#0D0D0F] transition border-t border-[#E8E4DB] pt-3 cursor-pointer"
              >
                Sign in with another account
              </button>
            </div>
          </div>
        ) : mode === "forgot" ? (
          /* Forgot Password */
          <form onSubmit={handleForgotPassword} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-[#0D0D0F]">Email Address</label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#71717A]" />
                <input
                  id="forgot-email-input"
                  type="email"
                  placeholder="name@domain.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full h-11 pl-10 pr-4 bg-[#F7F4EE] border border-[#E8E4DB] rounded-xl text-sm text-[#0D0D0F] focus:outline-none focus:border-[#0D0D0F] placeholder-[#A1A1AA] transition-colors"
                  required
                />
              </div>
            </div>

            <button
              id="auth-forgot-send-btn"
              type="submit"
              disabled={loading}
              className="w-full h-11 bg-[#0D0D0F] hover:bg-[#1A1A1D] text-[#F7F4EE] rounded-xl text-xs font-semibold uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer transition-all shadow-2xs mt-1"
            >
              {loading ? "Sending..." : "Send Reset Link"}
            </button>

            <button
              id="auth-forgot-back-btn"
              type="button"
              onClick={() => setMode("login")}
              className="text-center text-xs text-[#71717A] hover:text-[#0D0D0F] transition font-medium cursor-pointer"
            >
              Back to login
            </button>
          </form>
        ) : (
          /* Login / Signup */
          <motion.form
            variants={formContainerVariants}
            initial="hidden"
            animate="visible"
            onSubmit={handleEmailAuth}
            className="flex flex-col gap-4"
          >
            {/* Email or Username Field */}
            <motion.div variants={formItemVariants} className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-[#0D0D0F]">
                {mode === "login" ? "Email or Username" : "Email Address"}
              </label>
              <div className="relative">
                {mode === "login" && !email.includes("@") && email.length > 0 ? (
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#71717A]" />
                ) : (
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#71717A]" />
                )}
                <input
                  id="auth-email-input"
                  type={mode === "login" ? "text" : "email"}
                  placeholder={mode === "login" ? "name@domain.com or username" : "name@domain.com"}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full h-11 pl-10 pr-4 bg-[#F7F4EE] border border-[#E8E4DB] rounded-xl text-sm text-[#0D0D0F] focus:outline-none focus:border-[#0D0D0F] placeholder-[#A1A1AA] transition-colors"
                  required
                />
              </div>
            </motion.div>

            {/* Password Field */}
            <motion.div variants={formItemVariants} className="flex flex-col gap-1.5">
              <div className="flex justify-between items-center">
                <label className="text-xs font-semibold text-[#0D0D0F]">Password</label>
                {mode === "login" && (
                  <button
                    id="auth-to-forgot-btn"
                    type="button"
                    onClick={() => setMode("forgot")}
                    className="text-xs text-[#71717A] hover:text-[#0D0D0F] font-medium cursor-pointer"
                  >
                    Forgot?
                  </button>
                )}
              </div>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#71717A]" />
                <input
                  id="auth-password-input"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full h-11 pl-10 pr-10 bg-[#F7F4EE] border border-[#E8E4DB] rounded-xl text-sm text-[#0D0D0F] focus:outline-none focus:border-[#0D0D0F] placeholder-[#A1A1AA] transition-colors"
                  required
                />
                <button
                  id="auth-password-toggle"
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#71717A] hover:text-[#0D0D0F] cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </motion.div>

            {/* Submit Button */}
            <motion.div variants={formItemVariants} className="mt-1">
              <button
                id="auth-submit-btn"
                type="submit"
                disabled={loading || isSuccess}
                className={`w-full h-11 rounded-xl font-medium text-xs tracking-wider uppercase flex items-center justify-center gap-2 cursor-pointer transition-all shadow-2xs ${
                  isSuccess 
                    ? "bg-[#0D0D0F] text-[#C9A96E]" 
                    : "bg-[#0D0D0F] hover:bg-[#1A1A1D] text-[#F7F4EE]"
                }`}
              >
                {isSuccess ? (
                  <span className="flex items-center gap-2 text-[#C9A96E]">
                    <Check className="w-4 h-4" />
                    <span>Signed In</span>
                  </span>
                ) : loading ? (
                  <span className="text-[#A1A1AA] font-normal">Authenticating...</span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    {mode === "login" ? "Sign In" : "Create Account"} <ArrowRight className="w-3.5 h-3.5 text-[#C9A96E]" />
                  </span>
                )}
              </button>
            </motion.div>

            {/* Divider */}
            <motion.div variants={formItemVariants} className="relative my-1 flex items-center justify-center select-none">
              <span className="absolute inset-x-0 h-px bg-[#E8E4DB]"></span>
              <span className="relative px-3 bg-[#FFFFFF] text-[11px] font-normal text-[#A1A1AA]">
                or continue with
              </span>
            </motion.div>

            {/* Google Button */}
            <motion.div variants={formItemVariants}>
              <button
                id="auth-google-btn"
                type="button"
                onClick={handleGoogleLogin}
                disabled={isGoogleLoading || isSuccess}
                className="w-full h-11 rounded-xl flex items-center justify-center gap-2.5 font-medium text-xs border border-[#E8E4DB] bg-[#FFFFFF] hover:bg-[#F2EFE8] text-[#0D0D0F] cursor-pointer transition-all shadow-2xs"
              >
                {isGoogleLoading ? (
                  <div className="flex items-center gap-2 text-[#71717A]">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Connecting...</span>
                  </div>
                ) : (
                  <>
                    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                      <path
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                        fill="#4285F4"
                      />
                      <path
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        fill="#34A853"
                      />
                      <path
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                        fill="#FBBC05"
                      />
                      <path
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                        fill="#EA4335"
                      />
                    </svg>
                    <span>Continue with Google</span>
                  </>
                )}
              </button>
            </motion.div>

            {/* Mode Switch */}
            <motion.div variants={formItemVariants} className="text-center mt-2">
              <button
                id="auth-mode-switch-btn"
                type="button"
                onClick={() => {
                  setMode(mode === "login" ? "signup" : "login");
                  setError("");
                  setInfo("");
                }}
                className="text-xs text-[#71717A] hover:text-[#0D0D0F] transition font-normal cursor-pointer"
              >
                {mode === "login" ? (
                  <span>
                    New to SwapSkill? <span className="text-[#0D0D0F] font-semibold underline underline-offset-4 ml-1">Create account</span>
                  </span>
                ) : (
                  <span>
                    Already have an account? <span className="text-[#0D0D0F] font-semibold underline underline-offset-4 ml-1">Sign in</span>
                  </span>
                )}
              </button>
            </motion.div>
          </motion.form>
        )}
      </motion.div>
    </div>
  );
}
