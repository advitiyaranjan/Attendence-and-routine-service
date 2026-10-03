package com.studentos.app;

import android.os.CancellationSignal;

import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;

/**
 * Google sign-in inside the app: Google's account picker via Credential Manager.
 * The ID token is issued for the web client id (serverClientId), which the server checks;
 * Google matches the app itself against the Android OAuth client (package + signing SHA-1).
 */
@CapacitorPlugin(name = "GoogleSignIn")
public class GoogleSignInPlugin extends Plugin {

    /** { serverClientId, nonce } → { idToken }. Rejects with code "cancelled" when dismissed. */
    @PluginMethod
    public void signIn(PluginCall call) {
        String clientId = call.getString("serverClientId");
        if (clientId == null || clientId.isEmpty()) {
            call.reject("serverClientId is required");
            return;
        }
        GetSignInWithGoogleOption.Builder option = new GetSignInWithGoogleOption.Builder(clientId);
        String nonce = call.getString("nonce");
        if (nonce != null) option.setNonce(nonce);
        GetCredentialRequest request = new GetCredentialRequest.Builder().addCredentialOption(option.build()).build();

        CredentialManager.create(getContext()).getCredentialAsync(
            getActivity(),
            request,
            new CancellationSignal(),
            ContextCompat.getMainExecutor(getContext()),
            new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                @Override
                public void onResult(GetCredentialResponse result) {
                    Credential c = result.getCredential();
                    if (c instanceof CustomCredential && GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(c.getType())) {
                        try {
                            GoogleIdTokenCredential g = GoogleIdTokenCredential.createFrom(c.getData());
                            JSObject res = new JSObject();
                            res.put("idToken", g.getIdToken());
                            call.resolve(res);
                        } catch (Exception e) {
                            call.reject("Google sign-in failed", "failed", e);
                        }
                    } else {
                        call.reject("Unexpected credential", "failed");
                    }
                }

                @Override
                public void onError(@NonNull GetCredentialException e) {
                    if (e instanceof GetCredentialCancellationException) call.reject("Cancelled", "cancelled");
                    else call.reject(e.getMessage() == null ? "Google sign-in failed" : e.getMessage(), "failed", e);
                }
            }
        );
    }
}
