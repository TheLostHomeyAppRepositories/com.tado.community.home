import { TadoApiDevice } from "../../lib/tado-api-device";

import type { IntervalConfigurationCollection } from "homey-interval-manager";
import type { Termination, ZoneType } from "node-tado-client";

module.exports = class TadoRoomDevice extends TadoApiDevice {
    private get home_id(): number {
        return this.getData().homeId;
    }

    private get id(): number {
        return this.getData().id;
    }

    private get type(): ZoneType {
        return this.getData().type;
    }

    protected override get intervalConfigs(): IntervalConfigurationCollection<TadoRoomDevice> {
        return {
            ROOM_STATE: {
                functionName: "syncRoomState",
                settingName: "room_state_polling_interval",
            },
        };
    }

    async registerActionFlows(): Promise<void> {
        const resumeScheduleAction = this.homey.flow.getActionCard("tado_room_resume_schedule");
        resumeScheduleAction.registerRunListener(async () => {
            await this.resumeSchedule();
        });

        const boostHeatingAction = this.homey.flow.getActionCard("tado_room_boost_heating");
        boostHeatingAction.registerRunListener(async () => {
            await this.api.setBoostHeatingOverlay(this.home_id, [this.id]);
        });
    }

    protected override async start(): Promise<void> {
        this.registerCapabilityListener("button.restart_polling", async () => {
            await this.intervalManager.restart();
        });

        this.registerCapabilityListener("onoff", this.setOnOff.bind(this));
        this.registerCapabilityListener("tado_resume_schedule", this.resumeSchedule.bind(this));

        this.registerCapabilityListener("target_temperature", async (value) => {
            await this.setRoomTargetTemperature(value, "AUTO");
        });

        await this.registerActionFlows();
    }

    protected override async stop(): Promise<void> {
        await super.stop();
    }

    protected override async migrate(): Promise<void> {}

    /**
     * ------------------------------------------------------------------
     * Helper Functions
     * ------------------------------------------------------------------
     */
    protected async resumeSchedule(): Promise<void> {
        await this.api.clearZoneOverlays(this.home_id, [this.id]);
    }

    protected async setOnOff(value: boolean): Promise<void> {
        if (value) {
            await this.resumeSchedule();
        } else {
            await this.setRoomTargetTemperature(0.0, "MANUAL");
        }
    }

    protected async setRoomTargetTemperature(
        value: number,
        termination: Termination | number = "NEXT_TIME_BLOCK",
    ): Promise<void> {
        const isOff = value < 5.0;
        const previousValue = this.getCapabilityValue("target_temperature");
        const targetValue = Math.max(Math.min(value, 25.0), 5.0);

        await this.api
            .setZoneOverlays(
                this.home_id,
                [
                    {
                        zone_id: this.id,
                        power: isOff ? "OFF" : "ON",
                        temperature: isOff
                            ? null
                            : {
                                  celsius: targetValue,
                              },
                    },
                ],
                termination,
            )
            .then(async () => {
                await this.setCapabilityValue("target_temperature", targetValue);
            })
            .catch(async (...args) => {
                await this.setCapabilityValue("target_temperature", previousValue);
                this.error(...args);
            });
    }

    /**
     * ------------------------------------------------------------------
     * Room Info Management
     * ------------------------------------------------------------------
     */
    public async syncRoomState(): Promise<void> {
        const state = await this.api.getZoneState(this.home_id, this.id);
        // await this.setCapabilityValue("alarm_connectivity", state.link.state == "ONLINE");
        await this.setCapabilityValue("measure_humidity", state.sensorDataPoints.humidity.percentage);
        await this.setCapabilityValue("measure_temperature", state.sensorDataPoints.insideTemperature.celsius);
        await this.setCapabilityValue("target_temperature", state.setting.temperature?.celsius ?? 4.0);
        await this.setCapabilityValue("tado_presence_mode", state.tadoMode.toLowerCase());
        await this.setCapabilityValue("onoff", state.setting.power == "ON");
    }

    /**
     * ------------------------------------------------------------------
     * Device Event Management
     * ------------------------------------------------------------------
     */
};