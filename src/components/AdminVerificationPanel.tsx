import React, { useEffect, useState } from "react";
import {
  BadgeCheck,
  Check,
  ExternalLink,
  Lock,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  XCircle,
  Loader2,
} from "lucide-react";
import {
  AdminDecryptedVerificationItem,
  fetchAdminVerificationQueue,
  reviewVerificationApplication,
} from "../services/verificationService";
import { VerificationStatus, VerificationTier } from "../utils/verificationAdmin";
import { SmartImage } from "./SmartImage";
import { useApp } from "../context/AppContext";

interface AdminVerificationPanelProps {
  onStatusToast?: (msg: string, type: "success" | "error") => void;
}

function safeExternalUrl(raw?: string): string | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withProto);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
  } catch (_) {}
  return null;
}

export default function AdminVerificationPanel({ onStatusToast }: AdminVerificationPanelProps) {
  const { setProfileInCache, profilesCache } = useApp();
  const [statusTab, setStatusTab] = useState<VerificationStatus>("pending");
  const [items, setItems] = useState<AdminDecryptedVerificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [selectedTierByUid, setSelectedTierByUid] = useState<Record<string, VerificationTier>>({});
  const [rejectTargetUid, setRejectTargetUid] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [actingUid, setActingUid] = useState<string | null>(null);

  const loadQueue = async (tab: VerificationStatus, forceRefresh = false) => {
    setLoading(true);
    setErrorMsg("");
    try {
      const data = await fetchAdminVerificationQueue(tab, forceRefresh);
      setItems(data);
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to load verification queue.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadQueue(statusTab, false);
  }, [statusTab]);

  const handleApprove = async (item: AdminDecryptedVerificationItem) => {
    const uid = item.request.userId;
    const defaultTier: VerificationTier =
      item.request.category === "notable"
        ? "notable"
        : item.request.category === "educator"
        ? "mentor"
        : "verified";
    const tier = selectedTierByUid[uid] || defaultTier;

    setActingUid(uid);
    try {
      await reviewVerificationApplication({
        targetUserId: uid,
        decision: "approved",
        tier,
      });

      const cachedProfile = profilesCache[uid];
      if (cachedProfile) {
        setProfileInCache({
          ...cachedProfile,
          verified: true,
          verificationStatus: "approved",
          verificationTier: tier,
        });
      }

      setItems((prev) => prev.filter((x) => x.request.userId !== uid));
      onStatusToast?.(`Verified badge granted to ${item.dossier?.fullName || item.request.applicantName}`, "success");
    } catch (err: any) {
      onStatusToast?.(err?.message || "Failed to approve request", "error");
    } finally {
      setActingUid(null);
    }
  };

  const handleDeclineOrRevoke = async (uid: string, mode: "rejected" | "revoked") => {
    setActingUid(uid);
    try {
      await reviewVerificationApplication({
        targetUserId: uid,
        decision: mode,
        rejectionReason: rejectReason,
      });

      const cachedProfile = profilesCache[uid];
      if (cachedProfile) {
        setProfileInCache({
          ...cachedProfile,
          verified: false,
          verificationStatus: mode,
        });
      }

      setItems((prev) => prev.filter((x) => x.request.userId !== uid));
      setRejectTargetUid(null);
      setRejectReason("");
      onStatusToast?.(mode === "revoked" ? "Verification badge revoked" : "Request declined", "success");
    } catch (err: any) {
      onStatusToast?.(err?.message || "Failed to update verification status", "error");
    } finally {
      setActingUid(null);
    }
  };

  const tabs: Array<{ id: VerificationStatus; label: string }> = [
    { id: "pending", label: "Pending" },
    { id: "approved", label: "Approved" },
    { id: "rejected", label: "Declined" },
    { id: "revoked", label: "Revoked" },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Header / Refresh Bar */}
      <div className="rounded-[14px] bg-theme-surface dark:bg-[#1C1C1E] border border-theme-border/60 p-3.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-[#0D0D0F] text-[#C9A96E] flex items-center justify-center shrink-0">
            <Lock className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-theme-text-primary truncate">
              Encrypted Admin Vault
            </div>
            <div className="text-[11px] text-neutral-500 truncate">
              On-demand fetch only · 0 background listeners
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => loadQueue(statusTab, true)}
          disabled={loading}
          className="h-8 px-3 rounded-lg bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-[12px] font-medium text-theme-text-primary flex items-center gap-1.5 cursor-pointer shrink-0 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="grid grid-cols-4 gap-1 p-1 rounded-xl bg-neutral-200/70 dark:bg-neutral-800/80">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setStatusTab(t.id)}
            className={`h-8 rounded-lg text-[12px] font-medium transition cursor-pointer ${
              statusTab === t.id
                ? "bg-[#0D0D0F] text-[#F7F4EE] shadow-2xs"
                : "text-neutral-600 dark:text-neutral-300 hover:text-theme-text-primary"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {errorMsg && (
        <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 p-3 text-[12px] text-rose-600 dark:text-rose-400">
          {errorMsg}
        </div>
      )}

      {loading ? (
        <div className="py-12 flex flex-col items-center justify-center gap-2 text-neutral-500">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-xs">Fetching & decrypting applications...</span>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-[16px] bg-theme-surface dark:bg-[#1C1C1E] border border-theme-border/60 py-12 px-4 text-center flex flex-col items-center gap-2">
          <UserCheck className="w-7 h-7 text-neutral-400" />
          <p className="text-[14px] font-semibold text-theme-text-primary">
            No {statusTab} requests
          </p>
          <p className="text-[12px] text-neutral-500 max-w-xs">
            Verification applications matching this status will appear here when submitted.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3.5">
          {items.map((item) => {
            const { request, dossier, integrityVerified, decryptionError } = item;
            const uid = request.userId;
            const snap = dossier?.profileSnapshot;
            const currentTier: VerificationTier =
              selectedTierByUid[uid] ||
              request.assignedTier ||
              (request.category === "notable"
                ? "notable"
                : request.category === "educator"
                ? "mentor"
                : "verified");
            const isRejectOpen = rejectTargetUid === uid;
            const isBusy = actingUid === uid;

            const links = [
              { label: "Portfolio / Primary Proof", url: safeExternalUrl(dossier?.portfolioUrl) },
              { label: "Instagram", url: safeExternalUrl(dossier?.socialLinks?.instagram) },
              { label: "YouTube", url: safeExternalUrl(dossier?.socialLinks?.youtube) },
              { label: "LinkedIn", url: safeExternalUrl(dossier?.socialLinks?.linkedin) },
              { label: "GitHub", url: safeExternalUrl(dossier?.socialLinks?.github) },
              { label: "Website", url: safeExternalUrl(dossier?.socialLinks?.website) },
            ].filter((l) => Boolean(l.url));

            return (
              <div
                key={uid}
                className="rounded-[16px] bg-theme-surface dark:bg-[#1C1C1E] border border-theme-border/60 p-4 flex flex-col gap-3.5 shadow-2xs"
              >
                {/* Applicant Header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-11 h-11 rounded-full overflow-hidden border border-black/10 shrink-0">
                      <SmartImage
                        src={snap?.photoUrl}
                        alt={dossier?.fullName || request.applicantName}
                        fallbackType="profile"
                        fullName={dossier?.fullName || request.applicantName}
                      />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <h4 className="text-[14px] font-semibold text-theme-text-primary truncate">
                          {dossier?.fullName || request.applicantName}
                        </h4>
                        {request.status === "approved" && (
                          <BadgeCheck className="w-4 h-4 text-[#C9A96E] shrink-0" />
                        )}
                      </div>
                      <p className="text-[12px] text-neutral-500 truncate">
                        @{dossier?.username || request.applicantUsername || "member"} ·{" "}
                        <span className="capitalize">{request.category}</span>
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span
                      className={`inline-flex items-center gap-1 text-[11px] font-medium ${
                        integrityVerified
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-amber-600"
                      }`}
                    >
                      <ShieldCheck className="w-3.5 h-3.5" />
                      {integrityVerified ? "Decrypted" : "Encrypted"}
                    </span>
                    <div className="text-[10px] text-neutral-400 mt-0.5">
                      {request.submittedAtMs
                        ? new Date(request.submittedAtMs).toLocaleDateString()
                        : ""}
                    </div>
                  </div>
                </div>

                {decryptionError && (
                  <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-2.5 text-[11px] text-amber-700 dark:text-amber-300 flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 shrink-0" />
                    <span>Decryption notice: {decryptionError}</span>
                  </div>
                )}

                {/* Full Decrypted User Dossier */}
                {dossier && (
                  <>
                    <div className="grid grid-cols-4 gap-2 rounded-xl bg-black/[0.03] dark:bg-white/[0.04] p-2.5 text-center">
                      <div>
                        <div className="text-[13px] font-semibold tabular-nums text-theme-text-primary">
                          {snap?.sessionsCount ?? request.swapsSnapshot ?? 0}
                        </div>
                        <div className="text-[10px] text-neutral-500">Swaps</div>
                      </div>
                      <div>
                        <div className="text-[13px] font-semibold tabular-nums text-theme-text-primary">
                          {snap?.rating ? snap.rating.toFixed(1) : "—"}
                        </div>
                        <div className="text-[10px] text-neutral-500">Rating</div>
                      </div>
                      <div>
                        <div className="text-[13px] font-semibold tabular-nums text-theme-text-primary">
                          {snap?.followersCount ?? 0}
                        </div>
                        <div className="text-[10px] text-neutral-500">Followers</div>
                      </div>
                      <div>
                        <div className="text-[13px] font-semibold tabular-nums text-theme-text-primary">
                          {snap?.points ?? 0}
                        </div>
                        <div className="text-[10px] text-neutral-500">Points</div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-theme-border/60 divide-y divide-theme-border/50 text-[12px]">
                      <div className="px-3 py-2 flex justify-between gap-3">
                        <span className="text-neutral-500 shrink-0">Legal / Known Name</span>
                        <span className="font-medium text-theme-text-primary text-right break-all">
                          {dossier.legalOrKnownName}
                        </span>
                      </div>
                      <div className="px-3 py-2 flex justify-between gap-3">
                        <span className="text-neutral-500 shrink-0">Verified Email</span>
                        <span className="font-medium text-theme-text-primary text-right break-all">
                          {dossier.email}
                        </span>
                      </div>
                      <div className="px-3 py-2 flex justify-between gap-3">
                        <span className="text-neutral-500 shrink-0">Contact / Handle</span>
                        <span className="font-medium text-theme-text-primary text-right break-all">
                          {dossier.contactHandleOrPhone}
                        </span>
                      </div>
                      <div className="px-3 py-2 flex justify-between gap-3">
                        <span className="text-neutral-500 shrink-0">Location</span>
                        <span className="font-medium text-theme-text-primary text-right">
                          {[snap?.city, snap?.country].filter(Boolean).join(", ") || "Not set"}
                        </span>
                      </div>
                      <div className="px-3 py-2 flex justify-between gap-3">
                        <span className="text-neutral-500 shrink-0">Domain</span>
                        <span className="font-medium text-theme-text-primary text-right">
                          {dossier.domain}
                        </span>
                      </div>
                      {dossier.credentialReference && (
                        <div className="px-3 py-2 flex justify-between gap-3">
                          <span className="text-neutral-500 shrink-0">Credential Ref</span>
                          <span className="font-medium text-theme-text-primary text-right break-all">
                            {dossier.credentialReference}
                          </span>
                        </div>
                      )}
                      {snap?.skillsToTeach && snap.skillsToTeach.length > 0 && (
                        <div className="px-3 py-2 flex justify-between gap-3">
                          <span className="text-neutral-500 shrink-0">Skills Taught</span>
                          <span className="font-medium text-theme-text-primary text-right">
                            {snap.skillsToTeach.join(", ")}
                          </span>
                        </div>
                      )}
                      <div className="px-3 py-2 flex justify-between gap-3">
                        <span className="text-neutral-500 shrink-0">User ID</span>
                        <span className="font-mono text-[11px] text-neutral-500 text-right break-all">
                          {dossier.uid}
                        </span>
                      </div>
                    </div>

                    {dossier.statement && (
                      <div className="rounded-xl bg-black/[0.025] dark:bg-white/[0.03] p-3 text-[12px] text-theme-text-primary leading-relaxed">
                        <div className="text-[11px] font-medium text-neutral-500 mb-1">
                          Applicant Statement
                        </div>
                        {dossier.statement}
                      </div>
                    )}

                    {links.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {links.map((l) => (
                          <a
                            key={l.label}
                            href={l.url!}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-theme-border/70 text-[11px] font-medium text-[#007AFF] hover:bg-black/[0.03] transition"
                          >
                            <span>{l.label}</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        ))}
                      </div>
                    )}
                  </>
                )}

                {/* Admin Decision Controls */}
                {statusTab !== "approved" ? (
                  <div className="flex flex-col gap-2.5 pt-1 border-t border-theme-border/50">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-medium text-neutral-500">
                        Assign Badge Type
                      </span>
                      <select
                        value={currentTier}
                        onChange={(e) =>
                          setSelectedTierByUid((prev) => ({
                            ...prev,
                            [uid]: e.target.value as VerificationTier,
                          }))
                        }
                        className="h-8 px-2.5 rounded-lg border border-theme-border/70 bg-transparent text-[12px] text-theme-text-primary focus:outline-none"
                      >
                        <option value="verified">Verified</option>
                        <option value="notable">Notable Figure</option>
                        <option value="mentor">Verified Mentor</option>
                        <option value="creator">Verified Creator</option>
                      </select>
                    </div>

                    {isRejectOpen && (
                      <div className="flex flex-col gap-2">
                        <input
                          type="text"
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                          placeholder="Optional decline reason shown to user..."
                          className="h-9 px-3 rounded-lg border border-theme-border/70 bg-transparent text-[12px] text-theme-text-primary focus:outline-none"
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleDeclineOrRevoke(uid, "rejected")}
                            className="flex-1 h-9 rounded-lg bg-[#FF3B30] text-white text-[12px] font-medium cursor-pointer disabled:opacity-50"
                          >
                            Confirm Decline
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRejectTargetUid(null);
                              setRejectReason("");
                            }}
                            className="px-3 h-9 rounded-lg border border-theme-border/70 text-[12px] text-neutral-500 cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {!isRejectOpen && (
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleApprove(item)}
                          className="h-10 rounded-xl bg-[#0D0D0F] hover:bg-[#1A1A1D] text-[#F7F4EE] text-[12px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                        >
                          {isBusy ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Check className="w-3.5 h-3.5 text-[#C9A96E]" />
                          )}
                          <span>Approve & Grant Tick</span>
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => setRejectTargetUid(uid)}
                          className="h-10 rounded-xl border border-theme-border/70 text-[#FF3B30] hover:bg-rose-500/10 text-[12px] font-medium flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          <span>Decline</span>
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="pt-2 border-t border-theme-border/50 flex flex-col gap-2">
                    {isRejectOpen ? (
                      <div className="flex flex-col gap-2">
                        <input
                          type="text"
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                          placeholder="Reason for revoking verification..."
                          className="h-9 px-3 rounded-lg border border-theme-border/70 bg-transparent text-[12px] text-theme-text-primary focus:outline-none"
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleDeclineOrRevoke(uid, "revoked")}
                            className="flex-1 h-9 rounded-lg bg-[#FF3B30] text-white text-[12px] font-medium cursor-pointer disabled:opacity-50"
                          >
                            Confirm Revoke
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRejectTargetUid(null);
                              setRejectReason("");
                            }}
                            className="px-3 h-9 rounded-lg border border-theme-border/70 text-[12px] text-neutral-500 cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => setRejectTargetUid(uid)}
                        className="h-9 rounded-xl border border-rose-500/30 text-[#FF3B30] hover:bg-rose-500/10 text-[12px] font-medium cursor-pointer"
                      >
                        Revoke Verified Badge
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
