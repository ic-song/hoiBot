import { ApplicationError } from "../shared/application-error.js";
import type { ProfileRepository, ProfileView } from "./profile.js";

export class GetMyProfileService {
  constructor(private readonly profiles: ProfileRepository) {}

  async execute(providerCode: string, externalUserId: string): Promise<ProfileView> {
    const profile = await this.profiles.findByExternalIdentity(providerCode, externalUserId);
    if (profile === null) {
      throw new ApplicationError(
        "IDENTITY_MAPPING_REQUIRED",
        "승인된 사용자 식별자 연결이 필요합니다.",
        404
      );
    }
    return profile;
  }
}
