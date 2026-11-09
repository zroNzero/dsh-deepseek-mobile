import java.net.HttpURLConnection;
import java.net.URL;

public class TestProxy {
    public static void main(String[] args) throws Exception {
        String[] urls = {
            "https://dl.google.com/dl/android/maven2/com/android/application/com.android.application.gradle.plugin/8.5.2/com.android.application.gradle.plugin-8.5.2.pom",
            "https://repo.maven.apache.org/maven2/org/jetbrains/kotlin/kotlin-stdlib/1.9.24/kotlin-stdlib-1.9.24.pom"
        };
        for (String u : urls) {
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(u).openConnection();
                c.setConnectTimeout(15000);
                c.setReadTimeout(15000);
                c.setRequestMethod("HEAD");
                System.out.println(u + " -> " + c.getResponseCode());
            } catch (Exception e) {
                System.out.println(u + " -> ERROR " + e);
            }
        }
    }
}
