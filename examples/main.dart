// Copy to lib/main.dart in your Flutter test app to run the generated screen.
import 'package:flutter/material.dart';
import 'generated/login.g.dart';

void main() => runApp(const DemoApp());

class DemoApp extends StatelessWidget {
  const DemoApp({super.key});

  @override
  Widget build(BuildContext context) {
    return const MaterialApp(
      debugShowCheckedModeBanner: false,
      home: LoginScreen(),
    );
  }
}
