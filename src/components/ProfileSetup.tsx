import React, { useState } from "react";
import { doc, setDoc } from "firebase/firestore";
import { db, auth } from "../firebase";
import { Country } from "../data/countries";
import CountryPicker from "./CountryPicker";
import { User, Globe, MessageSquare, BookOpen, Clock, MapPin, Camera, Sparkles, Plus, X } from "lucide-react";
import { DEFAULT_AVATAR } from "../types";
import { useApp } from "../context/AppContext";

interface ProfileSetupProps {
  userId: string;
  email: string;
  onComplete: () => void;
}

const PREMIUM_AVATARS = [
  DEFAULT_AVATAR, // Custom default avatar silhouette with slash/plus
  "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=200&q=80", // Luxury Dark Wavy Silk
  "https://images.unsplash.com/photo-1634017839464-5c339ebe3cb4?auto=format&fit=crop&w=200&q=80", // Minimalist Dark Gold Geometric
  "https://images.unsplash.com/photo-1614850523459-c2f4c699c52e?auto=format&fit=crop&w=200&q=80", // Luxury Dark Gold Texture
  "https://images.unsplash.com/photo-1550684848-fac1c5b4e853?auto=format&fit=crop&w=200&q=80"  // Minimalist Slate Gold Geometric
];

const TIMEZONES = [
  "UTC (GMT +00:00)",
  "EST (GMT -05:00) Eastern Time",
  "CST (GMT -06:00) Central Time",
  "MST (GMT -07:00) Mountain Time",
  "PST (GMT -08:00) Pacific Time",
  "CET (GMT +01:00) Central European Time",
  "EET (GMT +02:00) Eastern European Time",
  "IST (GMT +05:30) Indian Standard Time",
  "JST (GMT +09:00) Japan Standard Time",
  "AEST (GMT +10:00) Australian Eastern Time",
  "NZST (GMT +12:00) New Zealand Standard Time"
];

const AVAILABILITY_OPTIONS = [
  "Flexible",
  "Weekends Only",
  "Weekdays Evenings",
  "Mornings Only",
  "Highly Active (Everyday)"
];

export default function ProfileSetup({ userId, email, onComplete }: ProfileSetupProps) {
  const { currentUserProfile, updateProfile } = useApp();

  const [fullName, setFullName] = useState(currentUserProfile?.fullName || "");
  const [username, setUsername] = useState(currentUserProfile?.username || "");
  const [countryCode, setCountryCode] = useState(currentUserProfile?.countryCode || "");
  const [countryName, setCountryName] = useState(currentUserProfile?.country || "");
  const [city, setCity] = useState(currentUserProfile?.city || "");
  const [bio, setBio] = useState(currentUserProfile?.bio || "");
  const [availability, setAvailability] = useState(currentUserProfile?.availability || "Flexible");
  const [timezone, setTimezone] = useState(currentUserProfile?.timezone || "UTC (GMT +00:00)");
  const [photoUrl, setPhotoUrl] = useState(currentUserProfile?.photoUrl || PREMIUM_AVATARS[0]);

  // Photo upload states
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadProgress(5);
    setError("");

    try {
      const { compressImage } = await import("../utils/imageCompressor");
      const compressedBlob = await compressImage(file, 500, 500, 0.85);

      let savedCloudName = "";
      let savedUploadPreset = "";
      try {
        const safeLocalStorage = {
          getItem: (key: string) => {
            if (typeof window !== "undefined") {
              return window.localStorage.getItem(key);
            }
            return null;
          }
        };
        savedCloudName = safeLocalStorage.getItem("cloudinary_cloud_name") || "";
        savedUploadPreset = safeLocalStorage.getItem("cloudinary_upload_preset") || "";
      } catch (_) {}
      const activeCloudName = (import.meta as any).env?.VITE_CLOUDINARY_CLOUD_NAME || savedCloudName;
      const activeUploadPreset = (import.meta as any).env?.VITE_CLOUDINARY_UPLOAD_PRESET || savedUploadPreset;

      let imageUrl = "";

      if (activeCloudName && activeUploadPreset) {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `https://api.cloudinary.com/v1_1/${activeCloudName.trim()}/image/upload`, true);

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const progress = Math.round((event.loaded / event.total) * 100);
            setUploadProgress(Math.max(5, progress));
          }
        };

        const uploadPromise = new Promise<string>((resolve, reject) => {
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                const response = JSON.parse(xhr.responseText);
                if (response.secure_url) {
                  resolve(response.secure_url);
                } else {
                  reject(new Error("Cloudinary response missing secure_url"));
                }
              } catch (err) {
                reject(new Error("Invalid response from Cloudinary"));
              }
            } else {
              try {
                const response = JSON.parse(xhr.responseText);
                reject(new Error(response.error?.message || `Error ${xhr.status}`));
              } catch {
                reject(new Error(`Server error ${xhr.status}`));
              }
            }
          };
          xhr.onerror = () => reject(new Error("Network connection failed during upload"));
        });

        const formData = new FormData();
        formData.append("file", compressedBlob, `profile_photo_${userId}.jpg`);
        formData.append("upload_preset", activeUploadPreset.trim());
        formData.append("folder", "swap_skill_profiles");

        xhr.send(formData);
        imageUrl = await uploadPromise;
      } else {
        setUploadProgress(50);
        const base64Promise = new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error("Failed to convert image to base64 format"));
          reader.readAsDataURL(compressedBlob);
        });
        imageUrl = await base64Promise;
      }

      setPhotoUrl(imageUrl);
      setUploadProgress(100);
    } catch (err: any) {
      console.error("Error uploading profile image:", err);
      setError("Failed to upload profile image: " + (err.message || "Unknown error"));
    } finally {
      setUploading(false);
    }
  };

  // Tags arrays state
  const [languages, setLanguages] = useState<string[]>(currentUserProfile?.languages || ["English"]);
  const [currentLanguage, setCurrentLanguage] = useState("");

  const [skillsToTeach, setSkillsToTeach] = useState<string[]>(currentUserProfile?.skillsToTeach || []);
  const [currentSkillTeach, setCurrentSkillTeach] = useState("");

  const [skillsToLearn, setSkillsToLearn] = useState<string[]>(currentUserProfile?.skillsToLearn || []);
  const [currentSkillLearn, setCurrentSkillLearn] = useState("");

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Helper additions
  const addLanguage = () => {
    if (currentLanguage.trim() && !languages.includes(currentLanguage.trim())) {
      setLanguages([...languages, currentLanguage.trim()]);
      setCurrentLanguage("");
    }
  };

  const removeLanguage = (lang: string) => {
    setLanguages(languages.filter((l) => l !== lang));
  };

  const addSkillTeach = () => {
    if (currentSkillTeach.trim() && !skillsToTeach.includes(currentSkillTeach.trim())) {
      setSkillsToTeach([...skillsToTeach, currentSkillTeach.trim()]);
      setCurrentSkillTeach("");
    }
  };

  const removeSkillTeach = (skill: string) => {
    setSkillsToTeach(skillsToTeach.filter((s) => s !== skill));
  };

  const addSkillLearn = () => {
    if (currentSkillLearn.trim() && !skillsToLearn.includes(currentSkillLearn.trim())) {
      setSkillsToLearn([...skillsToLearn, currentSkillLearn.trim()]);
      setCurrentSkillLearn("");
    }
  };

  const removeSkillLearn = (skill: string) => {
    setSkillsToLearn(skillsToLearn.filter((s) => s !== skill));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    // 4. Required fields validations with specific field messages
    if (!fullName || typeof fullName !== "string" || !fullName.trim()) {
      setError("Validation failed: 'Full Name' is a required field and cannot be empty.");
      return;
    }
    if (fullName.length > 100) {
      setError("Validation failed: 'Full Name' cannot be longer than 100 characters.");
      return;
    }

    const sanitizedUsername = username.trim().toLowerCase().replace(/\s+/g, "");
    if (!sanitizedUsername || typeof sanitizedUsername !== "string") {
      setError("Validation failed: 'Username' is a required field and cannot be empty.");
      return;
    }
    if (sanitizedUsername.length > 30) {
      setError("Validation failed: 'Username' cannot be longer than 30 characters.");
      return;
    }

    if (!countryName || typeof countryName !== "string" || !countryName.trim()) {
      setError("Validation failed: 'Country' is a required field and cannot be empty.");
      return;
    }

    if (!city || typeof city !== "string" || !city.trim()) {
      setError("Validation failed: 'City' is a required field and cannot be empty.");
      return;
    }

    if (!bio || typeof bio !== "string" || !bio.trim()) {
      setError("Validation failed: 'Biography' is a required field and cannot be empty.");
      return;
    }
    if (bio.length > 500) {
      setError("Validation failed: 'Biography' cannot be longer than 500 characters.");
      return;
    }

    if (!skillsToTeach || !Array.isArray(skillsToTeach) || skillsToTeach.length === 0) {
      setError("Validation failed: You must add at least one skill to teach.");
      return;
    }

    if (!skillsToLearn || !Array.isArray(skillsToLearn) || skillsToLearn.length === 0) {
      setError("Validation failed: You must add at least one skill to learn.");
      return;
    }

    setLoading(true);

    try {
      // 3. Ensure authentication is ready
      let activeUser = auth.currentUser;
      if (!activeUser) {
        console.log("auth.currentUser is null. Waiting for auth state change...");
        try {
          await new Promise<void>((resolve, reject) => {
            const unsubscribe = auth.onAuthStateChanged((user) => {
              unsubscribe();
              if (user) {
                activeUser = user;
                resolve();
              } else {
                reject(new Error("No authenticated user found."));
              }
            });
            setTimeout(() => {
              unsubscribe();
              reject(new Error("Authentication timeout. Please sign in again."));
            }, 4000);
          });
        } catch (authErr: any) {
          console.error("Auth state loading failed:", authErr);
          setError(`Authentication error: ${authErr.message || authErr}`);
          setLoading(false);
          return;
        }
      }

      const finalUserId = activeUser?.uid || userId;
      if (!finalUserId) {
        setError("User ID could not be determined. Please re-authenticate.");
        setLoading(false);
        return;
      }

      // Save profile setup to Firestore
      const userDocRef = doc(db, "users", finalUserId);
      
      // 1. Avatar upload fallback - photoUrl is guaranteed
      const finalPhotoUrl = photoUrl || currentUserProfile?.photoUrl || PREMIUM_AVATARS[0];

      const rawProfileData = {
        uid: finalUserId,
        email: activeUser?.email || email || "",
        fullName: fullName.trim(),
        username: sanitizedUsername,
        country: countryName,
        countryCode: countryCode || "",
        city: city.trim(),
        languages: languages || ["English"],
        skillsToTeach: skillsToTeach || [],
        skillsToLearn: skillsToLearn || [],
        bio: bio.trim(),
        availability: availability || "Flexible",
        timezone: timezone || "UTC (GMT +00:00)",
        photoUrl: finalPhotoUrl,
        createdAt: currentUserProfile?.createdAt || new Date(),
        followersCount: currentUserProfile?.followersCount || 0,
        followingCount: currentUserProfile?.followingCount || 0,
        points: currentUserProfile?.points || 0,
        sessionsCount: currentUserProfile?.sessionsCount || 0,
        rating: currentUserProfile?.rating || 0
      };

      // 2. Remove any undefined properties before writing
      const cleanProfileData: any = {};
      Object.entries(rawProfileData).forEach(([key, val]) => {
        if (val !== undefined && val !== null) {
          cleanProfileData[key] = val;
        }
      });

      await setDoc(userDocRef, cleanProfileData);
      updateProfile(cleanProfileData as any);
      onComplete();
    } catch (err: any) {
      // 5. Catch exact Firebase error
      console.error("EXACT FIREBASE ERROR SAVING PROFILE:", err);
      const firebaseCode = err?.code || "";
      const firebaseMessage = err?.message || "";
      const detailedError = firebaseCode 
        ? `${firebaseCode} (${firebaseMessage})`
        : firebaseMessage || JSON.stringify(err);
      
      setError(`Failed to save profile. Error: ${detailedError}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div 
      className="h-full w-full flex-1 bg-white text-gray-900 font-sans overflow-y-auto overscroll-y-contain mobile-scroll pb-24 touch-pan-y"
      style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}
    >
      <div className="max-w-md mx-auto px-5 sm:px-6 py-6 sm:py-8 flex flex-col min-h-full">
        
        {/* Header */}
        <div className="text-center mb-8">
          <span className="text-[10px] font-mono tracking-widest text-blue-600 uppercase font-bold">Step 2 of 2</span>
          <h1 className="text-2xl font-sans font-bold mt-1 text-gray-900 tracking-tight">
            Profile Setup
          </h1>
          <p className="text-gray-500 text-xs mt-1.5 leading-relaxed">
            Introduce your expertise and aspirations to the global swap community.
          </p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-600">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-6 pb-12">
          
          {/* 1. Profile Photo Selection */}
          <div className="bg-slate-50 border border-gray-200 p-5 rounded-2xl flex flex-col items-center gap-4 shadow-xs">
            <span className="text-[10px] font-mono font-medium text-gray-500 uppercase tracking-wider self-start flex items-center gap-1.5">
              <Camera className="w-4 h-4 text-blue-600" /> Choose Profile Avatar
            </span>
            
            <div className="relative">
              <img
                src={photoUrl}
                alt="Selected Profile Avatar"
                referrerPolicy="no-referrer"
                className="w-24 h-24 rounded-full object-cover border-2 border-gray-200 shadow-md"
              />
              <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-white text-xs font-bold animate-pulse">
                ✦
              </div>
            </div>

            {/* Gallery Upload Option */}
            <div className="flex flex-col items-center gap-2 w-full mt-1">
              <label
                htmlFor="onboarding-upload-photo"
                className="w-full h-10 border border-gray-200 rounded-xl bg-white text-gray-700 font-semibold text-xs flex items-center justify-center gap-1.5 hover:bg-slate-100 cursor-pointer transition shadow-xs"
              >
                <Camera className="w-4 h-4 text-blue-600" />
                {uploading ? `Uploading (${uploadProgress}%)` : "Upload from Gallery"}
              </label>
              <input
                id="onboarding-upload-photo"
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                disabled={uploading}
                className="hidden"
              />
              {uploading && (
                <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                  <div className="bg-blue-600 h-full transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
                </div>
              )}
            </div>

            <div className="text-[9px] font-mono text-gray-500 uppercase tracking-wider text-center mt-1">
              Or pick an exclusive preset:
            </div>

            <div className="flex gap-2.5">
              {PREMIUM_AVATARS.map((avatar, idx) => (
                <button
                  id={`avatar-choice-${idx}`}
                  key={idx}
                  type="button"
                  onClick={() => setPhotoUrl(avatar)}
                  className={`w-10 h-10 rounded-full overflow-hidden border-2 cursor-pointer transition ${
                    photoUrl === avatar ? "border-blue-600 scale-105" : "border-transparent opacity-60 hover:opacity-100"
                  }`}
                >
                  <img src={avatar} alt="Avatar option" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          </div>

          {/* 2. Basic Information */}
          <div className="bg-slate-50 border border-gray-200 p-5 rounded-2xl flex flex-col gap-4 shadow-xs">
            <span className="text-[10px] font-mono font-medium text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
              <User className="w-4 h-4 text-blue-600" /> Basic Details
            </span>

            {/* Full Name */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[9px] font-mono font-semibold text-gray-500 uppercase tracking-wider">Full Name</label>
              <input
                id="setup-fullname"
                type="text"
                placeholder="Jane Doe"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full h-11 px-4 bg-white border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-blue-500 text-gray-900 placeholder-gray-400"
                required
              />
            </div>

            {/* Username */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[9px] font-mono font-semibold text-gray-500 uppercase tracking-wider">Username</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-xs font-mono">@</span>
                <input
                  id="setup-username"
                  type="text"
                  placeholder="janedoe"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full h-11 pl-8 pr-4 bg-white border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-blue-500 text-gray-900 placeholder-gray-400"
                  required
                />
              </div>
            </div>
          </div>

          {/* 3. Location */}
          <div className="bg-slate-50 border border-gray-200 p-5 rounded-2xl flex flex-col gap-4 shadow-xs">
            <span className="text-[10px] font-mono font-medium text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
              <MapPin className="w-4 h-4 text-blue-600" /> Geographic Info
            </span>

            {/* Country */}
            <CountryPicker
              selectedCode={countryCode}
              onChange={(c) => {
                setCountryCode(c.code);
                setCountryName(c.name);
              }}
              label="Country"
            />

            {/* City */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[9px] font-mono font-semibold text-gray-500 uppercase tracking-wider">City</label>
              <input
                id="setup-city"
                type="text"
                placeholder="San Francisco"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="w-full h-11 px-4 bg-white border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-blue-500 text-gray-900 placeholder-gray-400"
                required
              />
            </div>
          </div>

          {/* 4. Languages */}
          <div className="bg-slate-50 border border-gray-200 p-5 rounded-2xl flex flex-col gap-4 shadow-xs">
            <span className="text-[10px] font-mono font-medium text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
              <Globe className="w-4 h-4 text-blue-600" /> Languages Spoken
            </span>

            <div className="flex gap-2">
              <input
                id="setup-language-input"
                type="text"
                placeholder="e.g. Spanish, French"
                value={currentLanguage}
                onChange={(e) => setCurrentLanguage(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addLanguage())}
                className="flex-1 h-11 px-4 bg-white border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-blue-500 text-gray-900 placeholder-gray-400"
              />
              <button
                id="setup-add-language"
                type="button"
                onClick={addLanguage}
                className="w-11 h-11 bg-white border border-gray-200 rounded-xl flex items-center justify-center hover:bg-slate-100 transition text-gray-700 cursor-pointer shadow-xs"
              >
                <Plus className="w-5 h-5" />
              </button>
            </div>

            {/* Languages Tags List */}
            <div className="flex flex-wrap gap-2">
              {languages.map((lang) => (
                <span
                  key={lang}
                  className="px-2.5 py-1 bg-blue-50 border border-blue-200 text-xs text-blue-700 rounded-lg flex items-center gap-1.5 font-sans"
                >
                  {lang}
                  <button
                    id={`remove-language-${lang}`}
                    type="button"
                    onClick={() => removeLanguage(lang)}
                    className="text-gray-400 hover:text-gray-700 transition cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </span>
              ))}
              {languages.length === 0 && (
                <span className="text-xs text-gray-400 italic">No languages added yet.</span>
              )}
            </div>
          </div>

          {/* 5. Skills I Teach */}
          <div className="bg-slate-50 border border-gray-200 p-5 rounded-2xl flex flex-col gap-4 shadow-xs">
            <span className="text-[10px] font-mono font-medium text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-amber-500" /> Skills I Teach
            </span>

            <div className="flex gap-2">
              <input
                id="setup-teach-input"
                type="text"
                placeholder="e.g. Python, UX Design, Piano"
                value={currentSkillTeach}
                onChange={(e) => setCurrentSkillTeach(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addSkillTeach())}
                className="flex-1 h-11 px-4 bg-white border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-blue-500 text-gray-900 placeholder-gray-400"
              />
              <button
                id="setup-add-teach"
                type="button"
                onClick={addSkillTeach}
                className="w-11 h-11 bg-white border border-gray-200 rounded-xl flex items-center justify-center hover:bg-slate-100 transition text-gray-700 cursor-pointer shadow-xs"
              >
                <Plus className="w-5 h-5" />
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              {skillsToTeach.map((skill) => (
                <span
                  key={skill}
                  className="px-2.5 py-1 bg-amber-50 border border-amber-200 text-xs text-amber-800 rounded-lg flex items-center gap-1.5 font-sans"
                >
                  {skill}
                  <button
                    id={`remove-teach-${skill}`}
                    type="button"
                    onClick={() => removeSkillTeach(skill)}
                    className="text-gray-400 hover:text-gray-700 transition cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </span>
              ))}
              {skillsToTeach.length === 0 && (
                <span className="text-xs text-gray-400 italic">Add skills you can share or mentor.</span>
              )}
            </div>
          </div>

          {/* 6. Skills I Want To Learn */}
          <div className="bg-slate-50 border border-gray-200 p-5 rounded-2xl flex flex-col gap-4 shadow-xs">
            <span className="text-[10px] font-mono font-medium text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
              <BookOpen className="w-4 h-4 text-blue-600" /> Skills I Want To Learn
            </span>

            <div className="flex gap-2">
              <input
                id="setup-learn-input"
                type="text"
                placeholder="e.g. French Fluency, Public Speaking"
                value={currentSkillLearn}
                onChange={(e) => setCurrentSkillLearn(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addSkillLearn())}
                className="flex-1 h-11 px-4 bg-white border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-blue-500 text-gray-900 placeholder-gray-400"
              />
              <button
                id="setup-add-learn"
                type="button"
                onClick={addSkillLearn}
                className="w-11 h-11 bg-white border border-gray-200 rounded-xl flex items-center justify-center hover:bg-slate-100 transition text-gray-700 cursor-pointer shadow-xs"
              >
                <Plus className="w-5 h-5" />
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              {skillsToLearn.map((skill) => (
                <span
                  key={skill}
                  className="px-2.5 py-1 bg-blue-50 border border-blue-200 text-xs text-blue-700 rounded-lg flex items-center gap-1.5 font-sans"
                >
                  {skill}
                  <button
                    id={`remove-learn-${skill}`}
                    type="button"
                    onClick={() => removeSkillLearn(skill)}
                    className="text-gray-400 hover:text-gray-700 transition cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </span>
              ))}
              {skillsToLearn.length === 0 && (
                <span className="text-xs text-gray-400 italic">Add skills you wish to learn.</span>
              )}
            </div>
          </div>

          {/* 7. Bio */}
          <div className="bg-slate-50 border border-gray-200 p-5 rounded-2xl flex flex-col gap-4 shadow-xs">
            <span className="text-[10px] font-mono font-medium text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
              <MessageSquare className="w-4 h-4 text-blue-600" /> Short Bio
            </span>

            <textarea
              id="setup-bio"
              rows={4}
              maxLength={250}
              placeholder="Tell other craftspeople about yourself, your goals, or your professional background in 250 characters..."
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              className="w-full p-4 bg-white border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-blue-500 text-gray-900 placeholder-gray-400 resize-none leading-relaxed"
              required
            />
            <div className="text-right text-[10px] text-gray-400 uppercase tracking-wider font-mono">
              {bio.length}/250 chars
            </div>
          </div>

          {/* 8. Availability */}
          <div className="bg-slate-50 border border-gray-200 p-5 rounded-2xl flex flex-col gap-4 shadow-xs">
            <span className="text-[10px] font-mono font-medium text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-blue-600" /> Availability
            </span>

            {/* Availability Option */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[9px] font-mono font-semibold text-gray-500 uppercase tracking-wider">Availability</label>
              <select
                id="setup-availability"
                value={availability}
                onChange={(e) => setAvailability(e.target.value)}
                className="w-full h-11 px-4 bg-white border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-blue-500 text-gray-900 cursor-pointer"
              >
                {AVAILABILITY_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Action Button */}
          <button
            id="setup-submit-btn"
            type="submit"
            disabled={loading}
            className="btn-vision-primary mt-2"
          >
            {loading ? "Creating Profile..." : "Complete Profile Setup ✦"}
          </button>

        </form>
      </div>
    </div>
  );
}
