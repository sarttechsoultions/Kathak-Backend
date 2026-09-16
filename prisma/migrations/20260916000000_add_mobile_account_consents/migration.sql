-- Store the terms/privacy acceptance made during mobile account creation.
ALTER TABLE "User"
ADD COLUMN "termsAcceptedAt" TIMESTAMP(3),
ADD COLUMN "privacyPolicyAcceptedAt" TIMESTAMP(3),
ADD COLUMN "consentVersion" TEXT;
