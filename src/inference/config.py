from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class InferenceSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore") #ignore extra var
    weights: str = "best.engine"
    violence_threshold: float = Field(default=0.6, ge=0, le=1)
    alert_cooldown_seconds: float = Field(default=30, ge=0)
    frame_timeout_seconds: float = Field(default=15, gt=0)
    inference_batch_size: int = Field(default=4, ge=1)
    frame_queue_size: int = Field(default=12, ge=1)
##
    @model_validator(mode="after")
    def queue_holds_batch(self):
        if self.frame_queue_size < self.inference_batch_size:
            raise ValueError("FRAME_QUEUE_SIZE must be at least INFERENCE_BATCH_SIZE")
        return self


settings = InferenceSettings()
