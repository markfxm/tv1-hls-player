package com.tv1.player;

import org.junit.Test;

import static org.junit.Assert.assertEquals;

public class DataSourceBackendSelectorTest {

    @Test
    public void resolveReturnsDefaultForNullOverride() {
        assertEquals(DataSourceBackend.DEFAULT, DataSourceBackendSelector.resolve(null, true));
    }

    @Test
    public void resolveReturnsDefaultForEmptyOverride() {
        assertEquals(DataSourceBackend.DEFAULT, DataSourceBackendSelector.resolve("", true));
    }

    @Test
    public void resolveReturnsDefaultForDefaultOverride() {
        assertEquals(DataSourceBackend.DEFAULT, DataSourceBackendSelector.resolve("default", true));
    }

    @Test
    public void resolveReturnsDefaultForUnknownOverride() {
        assertEquals(DataSourceBackend.DEFAULT, DataSourceBackendSelector.resolve("something-else", true));
    }

    @Test
    public void resolveReturnsOkHttpInDebugForCaseInsensitiveOverride() {
        assertEquals(DataSourceBackend.OKHTTP, DataSourceBackendSelector.resolve("OkHtTp", true));
    }

    @Test
    public void resolveReturnsDefaultInReleaseForOkHttpOverride() {
        assertEquals(DataSourceBackend.DEFAULT, DataSourceBackendSelector.resolve("okhttp", false));
    }
}
